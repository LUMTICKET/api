import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { busRoutes, drivers, schedules, vehicles } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId } from "@/lib/ownership";

/**
 * Operator schedules CRUD (owned profile).
 * GET /api/schedules — list with route/vehicle/driver context
 * POST /api/schedules — create departure
 * PUT /api/schedules?id=<scheduleId> — update (status transitions, seats)
 * DELETE /api/schedules?id=<scheduleId> — remove
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
        id: schedules.id,
        routeId: schedules.routeId,
        origin: busRoutes.origin,
        destination: busRoutes.destination,
        vehicleId: schedules.vehicleId,
        plate: vehicles.plate,
        driverId: schedules.driverId,
        driverName: drivers.name,
        departureAt: schedules.departureAt,
        seatsTotal: schedules.seatsTotal,
        seatsSold: schedules.seatsSold,
        status: schedules.status,
      })
      .from(schedules)
      .innerJoin(busRoutes, eq(schedules.routeId, busRoutes.id))
      .leftJoin(vehicles, eq(schedules.vehicleId, vehicles.id))
      .leftJoin(drivers, eq(schedules.driverId, drivers.id))
      .where(eq(schedules.businessProfileId, profile.id))
      .orderBy(asc(schedules.departureAt));

    return NextResponse.json({ schedules: rows });
  } catch (err) {
    console.error("List schedules error:", err);
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
    if (!body.routeId || !body.departureAt) {
      return NextResponse.json({ error: "routeId and departureAt are required" }, { status: 400 });
    }

    const [route] = await db
      .select({ id: busRoutes.id })
      .from(busRoutes)
      .where(and(eq(busRoutes.id, Number(body.routeId)), eq(busRoutes.businessProfileId, profile.id)))
      .limit(1);
    if (!route) return NextResponse.json({ error: "Route not found for this operator" }, { status: 404 });

    const departureAt = new Date(body.departureAt);
    if (Number.isNaN(departureAt.getTime())) {
      return NextResponse.json({ error: "Invalid departureAt" }, { status: 400 });
    }

    const [created] = await db
      .insert(schedules)
      .values({
        businessProfileId: profile.id,
        routeId: route.id,
        vehicleId: body.vehicleId ?? null,
        driverId: body.driverId ?? null,
        departureAt,
        seatsTotal: Number.isInteger(Number(body.seatsTotal)) ? Number(body.seatsTotal) : 0,
        seatsSold: 0,
        status: body.status ?? "scheduled",
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Create schedule error:", err);
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

    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return NextResponse.json({ error: "id query param required" }, { status: 400 });

    const [existing] = await db
      .select()
      .from(schedules)
      .where(and(eq(schedules.id, id), eq(schedules.businessProfileId, profile.id)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const departureAt = body.departureAt ? new Date(body.departureAt) : existing.departureAt;
    if (Number.isNaN(departureAt.getTime())) {
      return NextResponse.json({ error: "Invalid departureAt" }, { status: 400 });
    }

    const [updated] = await db
      .update(schedules)
      .set({
        vehicleId: body.vehicleId !== undefined ? body.vehicleId : existing.vehicleId,
        driverId: body.driverId !== undefined ? body.driverId : existing.driverId,
        departureAt,
        seatsTotal: body.seatsTotal !== undefined ? Number(body.seatsTotal) : existing.seatsTotal,
        seatsSold: body.seatsSold !== undefined ? Number(body.seatsSold) : existing.seatsSold,
        status: body.status ?? existing.status,
        updatedAt: new Date(),
      })
      .where(eq(schedules.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Update schedule error:", err);
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

    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return NextResponse.json({ error: "id query param required" }, { status: 400 });

    const [deleted] = await db
      .delete(schedules)
      .where(and(eq(schedules.id, id), eq(schedules.businessProfileId, profile.id)))
      .returning();

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete schedule error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
