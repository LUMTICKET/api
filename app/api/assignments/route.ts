import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { driverAssignments, drivers, schedules, vehicles } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId, parseId } from "@/lib/ownership";

const statuses = ["upcoming", "in-progress", "completed"] as const;

/**
 * Driver assignments (Dispatch & drivers panel, DriverTrip shape).
 * GET /api/assignments — list with driver/vehicle/schedule context
 * POST /api/assignments — create ({driverId required, vehicleId, scheduleId, passengerCount, parcelCount, status})
 * PUT /api/assignments?id=<id> — update
 * DELETE /api/assignments?id=<id> — remove
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
        id: driverAssignments.id,
        driverId: driverAssignments.driverId,
        driverName: drivers.name,
        vehicleId: driverAssignments.vehicleId,
        plate: vehicles.plate,
        scheduleId: driverAssignments.scheduleId,
        departureAt: schedules.departureAt,
        status: driverAssignments.status,
        passengerCount: driverAssignments.passengerCount,
        parcelCount: driverAssignments.parcelCount,
        createdAt: driverAssignments.createdAt,
      })
      .from(driverAssignments)
      .innerJoin(drivers, eq(driverAssignments.driverId, drivers.id))
      .leftJoin(vehicles, eq(driverAssignments.vehicleId, vehicles.id))
      .leftJoin(schedules, eq(driverAssignments.scheduleId, schedules.id))
      .where(eq(driverAssignments.businessProfileId, profile.id))
      .orderBy(desc(driverAssignments.createdAt));

    return NextResponse.json({ assignments: rows });
  } catch (err) {
    console.error("List assignments error:", err);
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
    const driverId = parseId(String(body.driverId ?? ""));
    if (!driverId) return NextResponse.json({ error: "driverId is required" }, { status: 400 });

    const [driver] = await db
      .select({ id: drivers.id })
      .from(drivers)
      .where(and(eq(drivers.id, driverId), eq(drivers.businessProfileId, profile.id)))
      .limit(1);
    if (!driver) return NextResponse.json({ error: "Driver not found for this operator" }, { status: 404 });

    const status = body.status ?? "upcoming";
    if (!statuses.includes(status)) {
      return NextResponse.json({ error: "status must be upcoming, in-progress, or completed" }, { status: 400 });
    }

    const [created] = await db
      .insert(driverAssignments)
      .values({
        businessProfileId: profile.id,
        driverId,
        vehicleId: body.vehicleId ?? null,
        scheduleId: body.scheduleId ?? null,
        status,
        passengerCount: Number.isInteger(Number(body.passengerCount)) ? Number(body.passengerCount) : 0,
        parcelCount: Number.isInteger(Number(body.parcelCount)) ? Number(body.parcelCount) : 0,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Create assignment error:", err);
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
      .from(driverAssignments)
      .where(and(eq(driverAssignments.id, id), eq(driverAssignments.businessProfileId, profile.id)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const status = body.status ?? existing.status;
    if (!statuses.includes(status)) {
      return NextResponse.json({ error: "status must be upcoming, in-progress, or completed" }, { status: 400 });
    }

    const [updated] = await db
      .update(driverAssignments)
      .set({
        vehicleId: body.vehicleId !== undefined ? body.vehicleId : existing.vehicleId,
        scheduleId: body.scheduleId !== undefined ? body.scheduleId : existing.scheduleId,
        status,
        passengerCount: body.passengerCount !== undefined ? Number(body.passengerCount) : existing.passengerCount,
        parcelCount: body.parcelCount !== undefined ? Number(body.parcelCount) : existing.parcelCount,
        updatedAt: new Date(),
      })
      .where(eq(driverAssignments.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Update assignment error:", err);
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
      .delete(driverAssignments)
      .where(and(eq(driverAssignments.id, id), eq(driverAssignments.businessProfileId, profile.id)))
      .returning();

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete assignment error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
