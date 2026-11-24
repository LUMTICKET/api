import { and, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { busBookings, payments } from "@/drizzle/schema";

/** How long seats stay reserved for a buyer who has started (but not finished) paying. */
export const SEAT_HOLD_MINUTES = 10;
/** Most seats one order can buy. */
export const MAX_SEATS_PER_ORDER = 6;

/** Seats are numbered "1".."seatsTotal". Returns the cleaned, de-duplicated list or null if invalid. */
export function parseSeatLabels(input: unknown, seatsTotal: number): string[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_SEATS_PER_ORDER) return null;
  const out: string[] = [];
  for (const raw of input) {
    const label = String(raw).trim();
    if (!/^[1-9]\d{0,3}$/.test(label)) return null;
    if (Number(label) > seatsTotal) return null;
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/** Seats that are sold (confirmed bookings) or held (a payment is in progress) for one departure. */
export async function getSeatState(scheduleId: number) {
  const booked = await db
    .select({ seats: busBookings.seats })
    .from(busBookings)
    .where(and(eq(busBookings.scheduleId, scheduleId), ne(busBookings.status, "cancelled")));
  const sold = new Set<string>();
  for (const b of booked) for (const s of b.seats ?? []) sold.add(String(s));

  const cutoff = new Date(Date.now() - SEAT_HOLD_MINUTES * 60_000);
  const pending = await db
    .select({ metadata: payments.metadata })
    .from(payments)
    .where(
      and(
        eq(payments.status, "pending"),
        gte(payments.createdAt, cutoff),
        sql`${payments.metadata}->'intent'->>'kind' = 'bus-purchase'`,
        sql`${payments.metadata}->'intent'->>'scheduleId' = ${String(scheduleId)}`,
      ),
    );
  const held = new Set<string>();
  for (const p of pending) {
    const intent = ((p.metadata ?? {}) as { intent?: { seats?: unknown[] } }).intent;
    for (const s of intent?.seats ?? []) if (!sold.has(String(s))) held.add(String(s));
  }
  return { sold, held };
}
