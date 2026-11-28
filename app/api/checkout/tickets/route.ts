import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, payments, ticketTypes } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { normalizeMsisdn, PAYMENT_PROVIDER, PaychanguError, paychanguErrorDetail, startPaychanguPayment } from "@/lib/paychangu";
import type { PurchaseIntent } from "@/lib/purchase";

const methods = ["card", "tnm", "airtel"] as const;
const MAX_QTY = 10;

/**
 * POST /api/checkout/tickets — any signed-in customer buys tickets for a published event.
 * Body: { ticketTypeId, quantity, method: tnm|airtel|card, phone? }
 *
 * The SERVER decides the price (ticket type price x quantity) and which business is paid;
 * the client never sends an amount. The booking is created only after the server has verified
 * the payment with PayChangu (webhook or status poll, see lib/paychangu.ts and lib/purchase.ts).
 *
 *  tnm | airtel + phone -> PIN prompt on the phone (when PayChangu direct charge is available)
 *  card / no method     -> `checkoutUrl` for PayChangu's secure hosted page (cards + mobile money)
 */
export async function POST(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const ticketTypeId = Number(body?.ticketTypeId);
    const quantity = Number(body?.quantity ?? 1);
    // With no method the customer picks mobile money or card on PayChangu's hosted page.
    const method = body?.method ?? "card";
    const phone = method === "card" || !body?.phone ? null : normalizeMsisdn(body.phone);

    if (!Number.isInteger(ticketTypeId) || ticketTypeId <= 0) {
      return NextResponse.json({ error: "ticketTypeId is required" }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return NextResponse.json({ error: `quantity must be between 1 and ${MAX_QTY}` }, { status: 400 });
    }
    if (!methods.includes(method)) {
      return NextResponse.json({ error: "method must be card, tnm, or airtel" }, { status: 400 });
    }
    if (method !== "card" && body?.phone && !phone) {
      return NextResponse.json({ error: "Enter a valid Malawian mobile money number, e.g. 0999 123 456" }, { status: 400 });
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
        provider: PAYMENT_PROVIDER,
        method,
        amount,
        currency: "MWK",
        status: "pending",
        reference,
        metadata: { paymentType: "ticket-purchase", intent },
      })
      .returning();

    try {
      const r = await startPaychanguPayment({
        paymentId: payment.id,
        reference,
        method,
        phone,
        amount,
        title: row.event.title,
        description: narrative,
        email: user.email,
        name: user.name,
        baseMetadata: { paymentType: "ticket-purchase", intent },
        audience: "buyer",
      });
      return NextResponse.json(
        { paymentId: payment.id, provider: PAYMENT_PROVIDER, status: "pending", amount, currency: "MWK", ...(r.checkoutUrl ? { checkoutUrl: r.checkoutUrl } : {}) },
        { status: 201 },
      );
    } catch (err) {
      await db
        .update(payments)
        .set({ status: "failed", metadata: { intent, initiationError: err instanceof PaychanguError ? err.body : String(err) }, updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
      if (err instanceof PaychanguError) {
        console.error("PayChangu rejected ticket payment:", err.status, err.body);
        return NextResponse.json(
          { error: paychanguErrorDetail(err.body) ?? "PayChangu could not start the payment", paymentId: payment.id, providerStatus: err.status },
          { status: err.status >= 400 && err.status < 500 ? 400 : 502 },
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
