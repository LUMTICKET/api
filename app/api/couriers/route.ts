import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { couriers, parcels } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId, parseId } from "@/lib/ownership";

const statuses = ["available", "on-route", "off-duty"] as const;

/**
 * Courier roster (Couriers & dispatch panel). active_parcels is derived by
 * counting parcels assigned to each courier that are not yet delivered/failed.
 * GET /api/couriers
 * POST /api/couriers — {name required, userId?, zone?, vehicle?, status?}
 * PUT /api/couriers?id=<id>
 * DELETE /api/couriers?id=<id>
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
        id: couriers.id,
        userId: couriers.userId,
        name: couriers.name,
        zone: couriers.zone,
        vehicle: couriers.vehicle,
        status: couriers.status,
        activeParcels: sql<number>`(
          SELECT COUNT(*)::int FROM "parcels" p
          WHERE p."courier_id" = ${couriers.id}
            AND p."status" NOT IN ('delivered', 'failed')
        )`,
        createdAt: couriers.createdAt,
      })
      .from(couriers)
      .where(eq(couriers.businessProfileId, profile.id))
      .orderBy(asc(couriers.name));

    return NextResponse.json({ couriers: rows });
  } catch (err) {
    console.error("List couriers error:", err);
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
    if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const status = body.status ?? "available";
    if (!statuses.includes(status)) {
      return NextResponse.json({ error: "status must be available, on-route, or off-duty" }, { status: 400 });
    }

    const [created] = await db
      .insert(couriers)
      .values({
        businessProfileId: profile.id,
        userId: body.userId ?? null,
        name: String(body.name),
        zone: body.zone ?? null,
        vehicle: body.vehicle ?? null,
        status,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Create courier error:", err);
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
      .from(couriers)
      .where(and(eq(couriers.id, id), eq(couriers.businessProfileId, profile.id)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const status = body.status ?? existing.status;
    if (!statuses.includes(status)) {
      return NextResponse.json({ error: "status must be available, on-route, or off-duty" }, { status: 400 });
    }

    const [updated] = await db
      .update(couriers)
      .set({
        name: body.name ?? existing.name,
        userId: body.userId !== undefined ? body.userId : existing.userId,
        zone: body.zone !== undefined ? body.zone : existing.zone,
        vehicle: body.vehicle !== undefined ? body.vehicle : existing.vehicle,
        status,
        updatedAt: new Date(),
      })
      .where(eq(couriers.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Update courier error:", err);
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

    // Detach parcels first so courier deletion does not drop their history.
    await db
      .update(parcels)
      .set({ courierId: null, updatedAt: new Date() })
      .where(and(eq(parcels.courierId, id), isNotNull(parcels.courierId)));

    const [deleted] = await db
      .delete(couriers)
      .where(and(eq(couriers.id, id), eq(couriers.businessProfileId, profile.id)))
      .returning();

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete courier error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
