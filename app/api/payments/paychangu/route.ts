import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, events, payments } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { publishingFeeMwk } from "@/lib/fees";
import {
  normalizeMsisdn,
  PAYMENT_PROVIDER,
  PaychanguError,
  paychanguErrorDetail,
  settlePaychanguPayment,
  startPaychanguPayment,
} from "@/lib/paychangu";

const methods = ["card", "tnm", "airtel"] as const;
type Method = (typeof methods)[number];

/**
 * POST /api/payments/paychangu — a business owner pays the listing publishing fee.
 * Body: { businessProfileId, method?: tnm|airtel|card, phone?, description? }
 *  tnm | airtel + phone -> PIN prompt on the phone (when PayChangu direct charge is available)
 *  card / anything else -> `checkoutUrl` for PayChangu's secure hosted page
 * The amount is always the server-side publishing fee. The payment only becomes "succeeded" once
 * the server has verified it with PayChangu (webhook or the GET poll below).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const businessProfileId = Number(body?.businessProfileId);
    const method = (body?.method ?? "card") as Method;
    const currency = body?.currency ?? "MWK";
    const amount = publishingFeeMwk();

    if (!Number.isInteger(businessProfileId) || businessProfileId <= 0) {
      return NextResponse.json({ error: "businessProfileId is required" }, { status: 400 });
    }
    if (!methods.includes(method)) return NextResponse.json({ error: "method must be card, tnm, or airtel" }, { status: 400 });
    if (String(currency).toUpperCase() !== "MWK") return NextResponse.json({ error: "Only MWK is supported" }, { status: 400 });

    // A mobile money number is optional: without a usable one, PayChangu's hosted page collects it.
    const phone = method === "card" || !body?.phone ? null : normalizeMsisdn(body.phone);
    if (method !== "card" && body?.phone && !phone) {
      return NextResponse.json({ error: "Enter a valid Malawian mobile money number, e.g. 0999 123 456" }, { status: 400 });
    }

    const [profile] = await db
      .select({ id: businessProfiles.id })
      .from(businessProfiles)
      .where(and(eq(businessProfiles.id, businessProfileId), eq(businessProfiles.userId, user.id)))
      .limit(1);
    if (!profile) return NextResponse.json({ error: "Business profile not found or not owned by user" }, { status: 404 });

    const reference = `LT${crypto.randomBytes(8).toString("hex").toUpperCase()}`; // 18 chars, unique per payment
    const narrative = String(body?.description ?? "Event publishing fee").slice(0, 100);

    const [payment] = await db
      .insert(payments)
      .values({
        businessProfileId: profile.id,
        userId: user.id,
        provider: PAYMENT_PROVIDER,
        method,
        amount,
        currency: "MWK",
        status: "pending",
        reference,
        metadata: { paymentType: "publishing-fee" },
      })
      .returning();

    try {
      const r = await startPaychanguPayment({
        paymentId: payment.id,
        reference,
        method,
        phone,
        amount,
        title: "Event publishing fee",
        audience: "business",
        baseMetadata: { paymentType: "publishing-fee" },
        description: narrative,
        email: user.email,
        name: user.name,
      });
      return NextResponse.json({ ...payment, ...(r.checkoutUrl ? { checkoutUrl: r.checkoutUrl } : {}) }, { status: 201 });
    } catch (err) {
      await db
        .update(payments)
        .set({ status: "failed", metadata: { initiationError: err instanceof PaychanguError ? err.body : String(err) }, updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
      if (err instanceof PaychanguError) {
        console.error("PayChangu rejected payment initiation:", err.status, err.body);
        return NextResponse.json(
          { error: paychanguErrorDetail(err.body) ?? "PayChangu could not start the payment", paymentId: payment.id, providerStatus: err.status },
          { status: err.status >= 400 && err.status < 500 ? 400 : 502 },
        );
      }
      console.error("PayChangu initiation error:", err);
      return NextResponse.json({ error: "Could not start the payment. Please try again.", paymentId: payment.id }, { status: 502 });
    }
  } catch (error) {
    console.error("Create payment error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// GET /api/payments/paychangu?businessProfileId=  (list)  or  &paymentId= (poll one)
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
      let [one] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.businessProfileId, businessProfileId)))
        .limit(1);
      // Ask PayChangu itself so a missed webhook can't leave the payer stuck on "pending".
      if (one && one.provider === PAYMENT_PROVIDER && one.status === "pending") {
        await settlePaychanguPayment(one.id);
        [one] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
      }
      return one ? NextResponse.json(one) : NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    const [paymentRows, publishedEvents] = await Promise.all([
      db.select().from(payments).where(eq(payments.businessProfileId, businessProfileId)),
      db.select({ paymentId: events.paymentId }).from(events).where(eq(events.businessProfileId, businessProfileId)),
    ]);
    // Classify payments at the API boundary. Ticket purchases carry a purchase intent;
    // publishing fees are explicitly tagged, while older fee payments are identified
    // by the event they paid to publish. This keeps legacy records out of ticket sales.
    const publishingPaymentIds = new Set(
      publishedEvents.map((event) => event.paymentId).filter((id): id is number => id !== null),
    );
    return NextResponse.json(paymentRows.map((payment) => {
      const metadata = (payment.metadata ?? {}) as Record<string, unknown>;
      const intent = metadata.intent && typeof metadata.intent === "object"
        ? metadata.intent as Record<string, unknown>
        : null;
      const paymentType =
        intent?.kind === "ticket-purchase" || metadata.paymentType === "ticket-purchase"
          ? "ticket-purchase"
          : metadata.paymentType === "publishing-fee" || publishingPaymentIds.has(payment.id) ||
              (!intent && payment.amount >= publishingFeeMwk())
            ? "publishing-fee"
            : "other";
      return { ...payment, paymentType };
    }));
  } catch (error) {
    console.error("List payments error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
