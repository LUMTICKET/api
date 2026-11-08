import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, payments, ticketTypes } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
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
import type { PurchaseIntent } from "@/lib/purchase";

const methods = ["card", "tnm", "airtel"] as const;
const MAX_QTY = 10;

/**
 * POST /api/checkout/tickets — any signed-in customer buys tickets for a published event.
 * Body: { ticketTypeId, quantity, method: tnm|airtel|card, phone? }
 *
 * The SERVER decides the price (ticket type price x quantity) and which business is paid;
 * the client never sends an amount. The booking is created only after the signed OneKhusa
 * webhook marks the payment succeeded (see lib/purchase.ts).
 */
export async function POST(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const ticketTypeId = Number(body?.ticketTypeId);
    const quantity = Number(body?.quantity ?? 1);
    const method = body?.method;
    const phone = normalizeMsisdn(body?.phone);

    if (!Number.isInteger(ticketTypeId) || ticketTypeId <= 0) {
      return NextResponse.json({ error: "ticketTypeId is required" }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return NextResponse.json({ error: `quantity must be between 1 and ${MAX_QTY}` }, { status: 400 });
    }
    if (!methods.includes(method)) {
      return NextResponse.json({ error: "method must be card, tnm, or airtel" }, { status: 400 });
    }
    if (method !== "card" && !phone) {
      return NextResponse.json({ error: "A valid mobile money phone number is required" }, { status: 400 });
    }

    const [row] = await db
      .select({ ticket: ticketTypes, event: events })
      .from(ticketTypes)
      .innerJoin(events, eq(ticketTypes.eventId, events.id))
      .where(eq(ticketTypes.id, ticketTypeId))
      .limit(1);
    if (!row || row.event.status !== "published" || row.event.startsAt <= new Date()) {
      return NextResponse.json({ error: "This ticket is not on sale" }, { status: 404 });
    }
    if (row.ticket.currency.toUpperCase() !== "MWK") {
      return NextResponse.json({ error: "Only MWK is supported" }, { status: 400 });
    }
    if (quantity > row.event.maxPerUser) {
      return NextResponse.json({ error: `You can buy at most ${row.event.maxPerUser} tickets for this event` }, { status: 400 });
    }
    if (row.ticket.remaining < quantity) {
      return NextResponse.json(
        { error: row.ticket.remaining === 0 ? "Sold out" : `Only ${row.ticket.remaining} left` },
        { status: 409 },
      );
    }

    const amount = row.ticket.price * quantity;
    if (!Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: "This ticket cannot be purchased online" }, { status: 400 });
    }

    const intent: PurchaseIntent = {
      kind: "ticket-purchase",
      ticketTypeId: row.ticket.id,
      eventId: row.event.id,
      quantity,
      ticketName: row.ticket.name,
      eventTitle: row.event.title,
    };
    const reference = `LT${crypto.randomBytes(8).toString("hex").toUpperCase()}`; // 18 chars
    const narrative = `${quantity} x ${row.ticket.name} - ${row.event.title}`.slice(0, 100);

    const [payment] = await db
      .insert(payments)
      .values({
        businessProfileId: row.event.businessProfileId,
        userId: user.id,
        provider: "onekhusa",
        method,
        amount,
        currency: "MWK",
        status: "pending",
        reference,
        metadata: { intent },
      })
      .returning();

    try {
      if (method === "card") {
        const r = await initiateHostedCheckout({ sourceReferenceNumber: reference, description: narrative, amount });
        await db
          .update(payments)
          .set({ metadata: { intent, paymentTransactionId: r.paymentTransactionId } })
          .where(eq(payments.id, payment.id));
        return NextResponse.json({ paymentId: payment.id, status: "pending", amount, currency: "MWK", checkoutUrl: r.checkoutUrl }, { status: 201 });
      }
      const r = await initiateMobileMoneyPush({
        connectorId: connectorIdFor(method),
        payerAccountNumber: phone as string,
        sourceReferenceNumber: reference,
        description: narrative,
        amount,
      });
      await db
        .update(payments)
        .set({ metadata: { intent, responseCode: r.responseCode, totalCharges: r.totalCharges, amountToPay: r.amountToPay } })
        .where(eq(payments.id, payment.id));
      return NextResponse.json(
        { paymentId: payment.id, status: "pending", amount, currency: "MWK", amountToPay: r.amountToPay, totalCharges: r.totalCharges },
        { status: 201 },
      );
    } catch (err) {
      await db
        .update(payments)
        .set({ status: "failed", metadata: { intent, initiationError: err instanceof OneKhusaError ? err.body : String(err) }, updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
      // A 4xx from OneKhusa is a validation problem with this request (bad payer
      // wallet, unknown connector, amount out of range). Surface its reason so
      // the buyer is not stuck with an opaque 502.
      if (err instanceof OneKhusaError && err.status >= 400 && err.status < 500) {
        const detail = errorDetail(err.body);
        console.error("OneKhusa rejected ticket payment:", err.status, err.body);
        return NextResponse.json(
          {
            error: detail ?? "OneKhusa rejected the payment request",
            paymentId: payment.id,
            providerStatus: err.status,
            ...(isSandbox() && method !== "card" && /phone|payer|msisdn|wallet/i.test(detail ?? "")
              ? { hint: sandboxWalletHint(method) }
              : {}),
          },
          { status: 400 },
        );
      }
      console.error("Ticket checkout initiation error:", err);
      return NextResponse.json({ error: "Could not start the payment. Please try again.", paymentId: payment.id }, { status: 502 });
    }
  } catch (err) {
    console.error("Ticket checkout error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
