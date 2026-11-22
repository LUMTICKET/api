import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { vehicles } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId, parseId } from "@/lib/ownership";

/**
 * Operator fleet CRUD (owned business profile only).
 * GET /api/fleet — list vehicles
 * POST /api/fleet — create vehicle
 * PUT /api/fleet?id=<vehicleId> — update vehicle
 * DELETE /api/fleet?id=<vehicleId> — delete vehicle
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const rows = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.businessProfileId, profile.id))
      .orderBy(asc(vehicles.plate));

    return NextResponse.json({ vehicles: rows });
  } catch (err) {
    console.error("List vehicles error:", err);
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
    if (!body.plate) {
      return NextResponse.json({ error: "plate is required" }, { status: 400 });
    }

    const [created] = await db
      .insert(vehicles)
      .values({
        businessProfileId: profile.id,
        plate: String(body.plate),
        type: body.type ?? null,
        capacity: Number.isInteger(Number(body.capacity)) ? Number(body.capacity) : 0,
        status: body.status ?? "active",
        roadworthyExpiry: body.roadworthyExpiry ?? null,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Create vehicle error:", err);
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
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.businessProfileId, profile.id)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const [updated] = await db
      .update(vehicles)
      .set({
        plate: body.plate ?? existing.plate,
        type: body.type !== undefined ? body.type : existing.type,
        capacity: body.capacity !== undefined ? Number(body.capacity) : existing.capacity,
        status: body.status ?? existing.status,
        roadworthyExpiry: body.roadworthyExpiry !== undefined ? body.roadworthyExpiry : existing.roadworthyExpiry,
        updatedAt: new Date(),
      })
      .where(eq(vehicles.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Update vehicle error:", err);
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
      .delete(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.businessProfileId, profile.id)))
      .returning();

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete vehicle error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
