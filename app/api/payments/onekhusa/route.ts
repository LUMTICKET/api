import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, payments } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import {
  connectorIdFor,
  errorDetail,
  initiateHostedCheckout,
  initiateMobileMoneyPush,
  isSandbox,
  normalizeMsisdn,
  OneKhusaError,
  sandboxWalletHint,
} from "@/lib/onekhusa";

const methods = ["card", "tnm", "airtel"] as const;
type Method = (typeof methods)[number];

/**
 * POST /api/payments/onekhusa
 * tnm | airtel -> real USSD/STK push to `phone`; returns pending payment.
 * card         -> OneKhusa hosted checkout; returns `checkoutUrl` to redirect to.
 * The payment becomes "succeeded" ONLY via the signed webhook.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { businessProfileId, amount, currency = "MWK", method = "card", phone, description } = await req.json();
    const numericAmount = Number(amount);

    if (!businessProfileId || !Number.isInteger(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: "businessProfileId and a positive integer amount are required" }, { status: 400 });
    }
    if (!methods.includes(method)) return NextResponse.json({ error: "method must be card, tnm, or airtel" }, { status: 400 });
    if (String(currency).toUpperCase() !== "MWK") return NextResponse.json({ error: "Only MWK is supported" }, { status: 400 });
    const msisdn = method === "card" ? null : normalizeMsisdn(phone);
    if (method !== "card" && !msisdn) {
      return NextResponse.json({ error: "A valid mobile money phone number is required" }, { status: 400 });
    }

    const [profile] = await db
      .select({ id: businessProfiles.id })
      .from(businessProfiles)
      .where(and(eq(businessProfiles.id, Number(businessProfileId)), eq(businessProfiles.userId, user.id)))
      .limit(1);
    if (!profile) return NextResponse.json({ error: "Business profile not found or not owned by user" }, { status: 404 });

    // 5-25 chars, unique per request (OneKhusa sourceReferenceNumber rule)
    const reference = `LT${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const narrative = String(description ?? "Event publishing fee").slice(0, 100);

    const [payment] = await db
      .insert(payments)
      .values({
        businessProfileId: profile.id,
        userId: user.id,
        provider: "onekhusa",
        method: method as Method,
        amount: numericAmount,
        currency: "MWK",
        status: "pending",
        reference,
        metadata: {},
      })
      .returning();

    try {
      if (method === "card") {
        const r = await initiateHostedCheckout({ sourceReferenceNumber: reference, description: narrative, amount: numericAmount });
        await db.update(payments).set({ metadata: { paymentTransactionId: r.paymentTransactionId } }).where(eq(payments.id, payment.id));
        return NextResponse.json({ ...payment, checkoutUrl: r.checkoutUrl }, { status: 201 });
      }

      const r = await initiateMobileMoneyPush({
        connectorId: connectorIdFor(method as "tnm" | "airtel"),
        payerAccountNumber: msisdn as string,
        sourceReferenceNumber: reference,
        description: narrative,
        amount: numericAmount,
      });
      const [updated] = await db
        .update(payments)
        .set({ metadata: { responseCode: r.responseCode, feeRuleCode: r.feeRuleCode, totalCharges: r.totalCharges, amountToPay: r.amountToPay } })
        .where(eq(payments.id, payment.id))
        .returning();
      return NextResponse.json({ ...updated, amountToPay: r.amountToPay, totalCharges: r.totalCharges }, { status: 201 });
    } catch (err) {
      await db
        .update(payments)
        .set({ status: "failed", metadata: { initiationError: err instanceof OneKhusaError ? err.body : String(err) }, updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
      // A 4xx from OneKhusa is a validation problem with this request (bad payer
      // wallet, unknown connector, amount out of range). Surface its reason so
      // the client is not stuck with an opaque 502.
      if (err instanceof OneKhusaError && err.status >= 400 && err.status < 500) {
        const detail = errorDetail(err.body);
        console.error("OneKhusa rejected payment initiation:", err.status, err.body);
        return NextResponse.json(
          {
            error: detail ?? "OneKhusa rejected the payment request",
            paymentId: payment.id,
            providerStatus: err.status,
            ...(isSandbox() && method !== "card" && /phone|payer|msisdn|wallet/i.test(detail ?? "")
              ? { hint: sandboxWalletHint(method as "tnm" | "airtel") }
              : {}),
          },
          { status: 400 },
        );
      }
      console.error("OneKhusa initiation error:", err);
      return NextResponse.json({ error: "Could not start payment with OneKhusa", paymentId: payment.id }, { status: 502 });
    }
  } catch (error) {
    console.error("Create payment error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// GET /api/payments/onekhusa?businessProfileId=  (list)  or  &paymentId= (poll one)
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const params = new URL(req.url).searchParams;
    const businessProfileId = Number(params.get("businessProfileId"));
    if (!businessProfileId) return NextResponse.json({ error: "businessProfileId is required" }, { status: 400 });

    const [profile] = await db
      .select({ id: businessProfiles.id })
      .from(businessProfiles)
      .where(and(eq(businessProfiles.id, businessProfileId), eq(businessProfiles.userId, user.id)))
      .limit(1);
    if (!profile) return NextResponse.json({ error: "Business profile not found or not owned by user" }, { status: 404 });

    const paymentId = Number(params.get("paymentId"));
    if (paymentId) {
      const [one] = await db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.businessProfileId, businessProfileId))).limit(1);
      return one ? NextResponse.json(one) : NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    return NextResponse.json(await db.select().from(payments).where(eq(payments.businessProfileId, businessProfileId)));
  } catch (error) {
    console.error("List payments error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
