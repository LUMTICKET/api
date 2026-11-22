import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { busBookings, schedules } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId, makeReference, parseId } from "@/lib/ownership";

const channels = ["online", "pos"] as const;
const statuses = ["confirmed", "checked-in", "cancelled"] as const;

/**
 * Operator bus bookings (owned profile).
 * GET /api/bus-bookings — list, newest first
 * POST /api/bus-bookings — create ({scheduleId, customerName, seats, amount, channel, status})
 * PUT /api/bus-bookings?id=<id> — update (status/channels/seats/amount)
 * DELETE /api/bus-bookings?id=<id> — remove
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const rows = await db
      .select({
        id: busBookings.id,
        reference: busBookings.reference,
        customerName: busBookings.customerName,
        scheduleId: busBookings.scheduleId,
        departureAt: schedules.departureAt,
        seats: busBookings.seats,
        amount: busBookings.amount,
        currency: busBookings.currency,
        channel: busBookings.channel,
        status: busBookings.status,
        createdAt: busBookings.createdAt,
      })
      .from(busBookings)
      .leftJoin(schedules, eq(busBookings.scheduleId, schedules.id))
      .where(eq(busBookings.businessProfileId, profile.id))
      .orderBy(desc(busBookings.createdAt));

    return NextResponse.json({ busBookings: rows });
  } catch (err) {
    console.error("List bus bookings error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const body = await req.json();
    if (!body.customerName) {
      return NextResponse.json({ error: "customerName is required" }, { status: 400 });
    }
    const channel = body.channel ?? "online";
    const status = body.status ?? "confirmed";
    if (!channels.includes(channel)) {
      return NextResponse.json({ error: "channel must be online or pos" }, { status: 400 });
    }
    if (!statuses.includes(status)) {
      return NextResponse.json({ error: "status must be confirmed, checked-in, or cancelled" }, { status: 400 });
    }

    const seats = Array.isArray(body.seats) ? body.seats.map(String) : [];
    const seatCount = seats.length;
    const scheduleId = parseId(String(body.scheduleId ?? ""));

    // Optional seat-inventory sync: bump the schedule's seats_sold for new
    // confirmed/checked-in bookings.
    let schedule: { id: number; seatsSold: number; seatsTotal: number } | null = null;
    if (scheduleId) {
      const [row] = await db
        .select({ id: schedules.id, seatsSold: schedules.seatsSold, seatsTotal: schedules.seatsTotal })
        .from(schedules)
        .where(and(eq(schedules.id, scheduleId), eq(schedules.businessProfileId, profile.id)))
        .limit(1);
      if (!row) return NextResponse.json({ error: "Schedule not found for this operator" }, { status: 404 });
      if (status !== "cancelled" && row.seatsSold + seatCount > row.seatsTotal) {
        return NextResponse.json({ error: "Not enough seats left on this schedule" }, { status: 409 });
      }
      schedule = row;
    }

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(busBookings)
        .values({
          businessProfileId: profile.id,
          reference: body.reference ?? makeReference("BUS"),
          customerName: String(body.customerName),
          scheduleId: schedule?.id ?? null,
          seats,
          amount: Number.isInteger(Number(body.amount)) ? Number(body.amount) : 0,
          currency: String(body.currency ?? "MWK").toUpperCase().slice(0, 3),
          channel,
          status,
        })
        .returning();

      if (schedule && status !== "cancelled" && seatCount > 0) {
        await tx
          .update(schedules)
          .set({ seatsSold: schedule.seatsSold + seatCount, updatedAt: new Date() })
          .where(eq(schedules.id, schedule.id));
      }

      return row;
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Create bus booking error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const id = parseId(new URL(req.url).searchParams.get("id") ?? "");
    if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

    const [existing] = await db
      .select()
      .from(busBookings)
      .where(and(eq(busBookings.id, id), eq(busBookings.businessProfileId, profile.id)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const status = body.status ?? existing.status;
    if (!statuses.includes(status)) {
      return NextResponse.json({ error: "status must be confirmed, checked-in, or cancelled" }, { status: 400 });
    }
    const channel = body.channel ?? existing.channel;
    if (!channels.includes(channel)) {
      return NextResponse.json({ error: "channel must be online or pos" }, { status: 400 });
    }

    // Keep schedule seat counts roughly in sync on status transitions.
    if (existing.scheduleId) {
      const seatDelta =
        (existing.status === "cancelled" ? 0 : -(existing.seats?.length ?? 0)) +
        (status === "cancelled" ? 0 : (body.seats ? (Array.isArray(body.seats) ? body.seats.length : existing.seats?.length ?? 0) : existing.seats?.length ?? 0));
      if (seatDelta !== 0) {
        const [schedule] = await db
          .select({ seatsSold: schedules.seatsSold })
          .from(schedules)
          .where(eq(schedules.id, existing.scheduleId))
          .limit(1);
        if (schedule) {
          await db
            .update(schedules)
            .set({ seatsSold: Math.max(0, schedule.seatsSold + seatDelta), updatedAt: new Date() })
            .where(eq(schedules.id, existing.scheduleId));
        }
      }
    }

    const [updated] = await db
      .update(busBookings)
      .set({
        customerName: body.customerName ?? existing.customerName,
        seats: Array.isArray(body.seats) ? body.seats.map(String) : existing.seats,
        amount: body.amount !== undefined ? Number(body.amount) : existing.amount,
        channel,
        status,
        updatedAt: new Date(),
      })
      .where(eq(busBookings.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Update bus booking error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const id = parseId(new URL(req.url).searchParams.get("id") ?? "");
    if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

    const [deleted] = await db
      .delete(busBookings)
      .where(and(eq(busBookings.id, id), eq(busBookings.businessProfileId, profile.id)))
      .returning();

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete bus booking error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
