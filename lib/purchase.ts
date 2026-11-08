import crypto from "crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookings, events, payments, reconciliationFlags, ticketTypes, type Booking } from "@/drizzle/schema";
import { ensureOperationalSchema } from "@/lib/ensure-schema";

/** Stored in payments.metadata when a customer starts a ticket purchase. */
export type PurchaseIntent = {
  kind: "ticket-purchase";
  ticketTypeId: number;
  eventId: number;
  quantity: number;
  ticketName: string;
  eventTitle: string;
};

export function readIntent(metadata: unknown): PurchaseIntent | null {
  const m = (metadata ?? {}) as Record<string, unknown>;
  const i = m.intent as Partial<PurchaseIntent> | undefined;
  if (!i || i.kind !== "ticket-purchase") return null;
  if (!Number.isInteger(i.ticketTypeId) || !Number.isInteger(i.eventId) || !Number.isInteger(i.quantity)) return null;
  return i as PurchaseIntent;
}

export type Fulfilment = { booking: Booking; problem?: undefined } | { booking?: undefined; problem: "sold-out" | "not-ready" };

/**
 * Idempotent: turns a SUCCEEDED ticket payment into exactly one booking and decrements stock.
 * Safe to call from the webhook, from the buyer's status poll, or both at once
 * (the payment row is locked and bookings.payment_id is unique).
 */
export async function fulfilTicketPurchase(paymentId: number): Promise<Fulfilment> {
  await ensureOperationalSchema();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`);
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!payment || payment.status !== "succeeded") return { problem: "not-ready" as const };
    const intent = readIntent(payment.metadata);
    if (!intent) return { problem: "not-ready" as const };

    const [existing] = await tx.select().from(bookings).where(eq(bookings.paymentId, payment.id)).limit(1);
    if (existing) return { booking: existing };

    const [event] = await tx.select().from(events).where(eq(events.id, intent.eventId)).limit(1);
    if (!event) return { problem: "not-ready" as const };

    // Take the stock only if it is still there.
    const taken = await tx
      .update(ticketTypes)
      .set({ remaining: sql`${ticketTypes.remaining} - ${intent.quantity}`, updatedAt: new Date() })
      .where(and(eq(ticketTypes.id, intent.ticketTypeId), gte(ticketTypes.remaining, intent.quantity)))
      .returning({ id: ticketTypes.id });

    if (!taken.length) {
      // Paid, but the last tickets went to someone else first: flag for refund instead of issuing.
      await tx
        .insert(reconciliationFlags)
        .values({
          gatewayRef: payment.reference,
          amount: payment.amount,
          currency: payment.currency,
          issue: `Paid for ${intent.quantity} x ${intent.ticketName} (${intent.eventTitle}) but stock ran out before fulfilment. Refund required.`,
          status: "needs-review",
        })
        .onConflictDoNothing();
      return { problem: "sold-out" as const };
    }

    const reference = `LMT-EVT-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const [booking] = await tx
      .insert(bookings)
      .values({
        userId: payment.userId,
        kind: "event",
        reference,
        title: `${intent.eventTitle} - ${intent.ticketName}`,
        detail: `${intent.quantity} x ${intent.ticketName}`,
        scheduledFor: event.startsAt,
        amount: payment.amount,
        currency: payment.currency,
        paymentId: payment.id,
        ticketTypeId: intent.ticketTypeId,
        quantity: intent.quantity,
        status: "upcoming",
      })
      .returning();
    return { booking };
  });
}
