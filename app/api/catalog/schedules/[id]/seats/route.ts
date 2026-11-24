import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { busRoutes, schedules } from "@/drizzle/schema";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getSeatState, MAX_SEATS_PER_ORDER } from "@/lib/bus-seats";

/**
 * GET /api/catalog/schedules/:id/seats — public seat map of one departure.
 * Seats are numbered 1..seatsTotal. `taken` are sold or being paid for right now.
 * `unassigned` = seats sold at the counter without a seat number (they reduce what can be bought).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureOperationalSchema();
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [row] = await db
      .select({ schedule: schedules })
      .from(schedules)
      .innerJoin(busRoutes, eq(schedules.routeId, busRoutes.id))
      .where(and(eq(schedules.id, id), eq(busRoutes.isPublished, true)))
      .limit(1);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { sold, held } = await getSeatState(id);
    const taken = [...new Set([...sold, ...held])].sort((a, b) => Number(a) - Number(b));
    const unassigned = Math.max(0, row.schedule.seatsSold - sold.size);
    const free = Math.max(0, row.schedule.seatsTotal - sold.size - held.size - unassigned);

    return NextResponse.json({
      scheduleId: id,
      seatsTotal: row.schedule.seatsTotal,
      taken,
      unassigned,
      seatsFree: free,
      maxPerOrder: Math.min(MAX_SEATS_PER_ORDER, free),
    });
  } catch (err) {
    console.error("Seat map error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
