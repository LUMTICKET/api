import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { drivers } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId } from "@/lib/ownership";

/**
 * Operator drivers CRUD (owned profile).
 * GET /api/drivers — roster
 * POST /api/drivers — add driver (optionally linked to a user account)
 * PUT /api/drivers?id=<driverId> — update
 * DELETE /api/drivers?id=<driverId> — remove
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
      .from(drivers)
      .where(eq(drivers.businessProfileId, profile.id))
      .orderBy(asc(drivers.name));

    return NextResponse.json({ drivers: rows });
  } catch (err) {
    console.error("List drivers error:", err);
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

    const [created] = await db
      .insert(drivers)
      .values({
        businessProfileId: profile.id,
        userId: body.userId ?? null,
        name: String(body.name),
        phone: body.phone ?? null,
        status: body.status ?? "available",
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Create driver error:", err);
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
      .from(drivers)
      .where(and(eq(drivers.id, id), eq(drivers.businessProfileId, profile.id)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const [updated] = await db
      .update(drivers)
      .set({
        name: body.name ?? existing.name,
        phone: body.phone !== undefined ? body.phone : existing.phone,
        status: body.status ?? existing.status,
        userId: body.userId !== undefined ? body.userId : existing.userId,
        updatedAt: new Date(),
      })
      .where(eq(drivers.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Update driver error:", err);
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
      .delete(drivers)
      .where(and(eq(drivers.id, id), eq(drivers.businessProfileId, profile.id)))
      .returning();

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete driver error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
