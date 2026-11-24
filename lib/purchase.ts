import crypto from "crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { busBookings, bookings, busRoutes, businessProfiles, events, payments, reconciliationFlags, schedules, ticketTypes, users, type Booking } from "@/drizzle/schema";
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

/** Stored in payments.metadata when a customer starts buying seats on a bus departure. */
export type BusPurchaseIntent = {
  kind: "bus-purchase";
  scheduleId: number;
  routeId: number;
  seats: string[];
  routeTitle: string;
  operator: string;
};

export function readBusIntent(metadata: unknown): BusPurchaseIntent | null {
  const m = (metadata ?? {}) as Record<string, unknown>;
  const i = m.intent as Partial<BusPurchaseIntent> | undefined;
  if (!i || i.kind !== "bus-purchase") return null;
  if (!Number.isInteger(i.scheduleId) || !Array.isArray(i.seats) || !i.seats.length) return null;
  return i as BusPurchaseIntent;
}

/** Any customer purchase (event tickets or bus seats). */
export function readAnyIntent(metadata: unknown): PurchaseIntent | BusPurchaseIntent | null {
  return readIntent(metadata) ?? readBusIntent(metadata);
}

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
  const [pay] = await db.select({ metadata: payments.metadata }).from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (pay && readBusIntent(pay.metadata)) return fulfilBusPurchase(paymentId);
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

/**
 * Idempotent: turns a SUCCEEDED bus payment into exactly one booking, takes the chosen seats and
 * bumps the departure's seats_sold. If the seats were taken meanwhile the payment is flagged for refund.
 */
export async function fulfilBusPurchase(paymentId: number): Promise<Fulfilment> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM payments WHERE id = ${paymentId} FOR UPDATE`);
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!payment || payment.status !== "succeeded") return { problem: "not-ready" as const };
    const intent = readBusIntent(payment.metadata);
    if (!intent) return { problem: "not-ready" as const };

    const [existing] = await tx.select().from(bookings).where(eq(bookings.paymentId, payment.id)).limit(1);
    if (existing) return { booking: existing };

    await tx.execute(sql`SELECT id FROM schedules WHERE id = ${intent.scheduleId} FOR UPDATE`);
    const [row] = await tx
      .select({ schedule: schedules, route: busRoutes, operator: businessProfiles.businessName })
      .from(schedules)
      .innerJoin(busRoutes, eq(schedules.routeId, busRoutes.id))
      .innerJoin(businessProfiles, eq(busRoutes.businessProfileId, businessProfiles.id))
      .where(eq(schedules.id, intent.scheduleId))
      .limit(1);
    if (!row) return { problem: "not-ready" as const };

    const existingBookings = await tx
      .select({ seats: busBookings.seats, status: busBookings.status })
      .from(busBookings)
      .where(eq(busBookings.scheduleId, intent.scheduleId));
    const taken = new Set<string>();
    for (const b of existingBookings) if (b.status !== "cancelled") for (const s of b.seats ?? []) taken.add(String(s));

    const clash = intent.seats.some((s) => taken.has(s));
    const overbooked = row.schedule.seatsSold + intent.seats.length > row.schedule.seatsTotal;
    if (clash || overbooked) {
      await tx
        .insert(reconciliationFlags)
        .values({
          gatewayRef: payment.reference,
          amount: payment.amount,
          currency: payment.currency,
          issue: `Paid for seat ${intent.seats.join(", ")} (${intent.routeTitle}) but the seats were no longer free. Refund required.`,
          status: "needs-review",
        })
        .onConflictDoNothing();
      return { problem: "sold-out" as const };
    }

    const [user] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, payment.userId)).limit(1);
    const reference = `LMT-BUS-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

    await tx.insert(busBookings).values({
      businessProfileId: row.schedule.businessProfileId,
      reference,
      customerName: user?.name || user?.email || "Online customer",
      scheduleId: intent.scheduleId,
      seats: intent.seats,
      amount: payment.amount,
      currency: payment.currency,
      channel: "online",
      status: "confirmed",
    });
    await tx
      .update(schedules)
      .set({ seatsSold: row.schedule.seatsSold + intent.seats.length, updatedAt: new Date() })
      .where(eq(schedules.id, intent.scheduleId));

    const [booking] = await tx
      .insert(bookings)
      .values({
        userId: payment.userId,
        kind: "bus",
        reference,
        title: intent.routeTitle,
        detail: `Seat ${intent.seats.join(", ")} · ${row.operator}`,
        scheduledFor: row.schedule.departureAt,
        amount: payment.amount,
        currency: payment.currency,
        paymentId: payment.id,
        quantity: intent.seats.length,
        status: "upcoming",
      })
      .returning();
    return { booking };
  });
}
