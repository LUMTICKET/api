import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { complianceDocuments } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId, parseId } from "@/lib/ownership";

/**
 * Compliance documents (bus-operator and courier Compliance panels).
 * daysLeft is computed at read time, never stored.
 * GET /api/compliance
 * POST /api/compliance — {subject, kind, expiresAt required, documentUrl?}
 * PUT /api/compliance?id=<id>
 * DELETE /api/compliance?id=<id>
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
      .from(complianceDocuments)
      .where(eq(complianceDocuments.businessProfileId, profile.id))
      .orderBy(asc(complianceDocuments.expiresAt));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const documents = rows.map((row) => {
      const expires = new Date(`${row.expiresAt}T00:00:00`);
      const daysLeft = Math.round((expires.getTime() - today.getTime()) / 86_400_000);
      return { ...row, daysLeft };
    });

    return NextResponse.json({ documents });
  } catch (err) {
    console.error("List compliance documents error:", err);
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
    if (!body.subject || !body.kind || !body.expiresAt) {
      return NextResponse.json({ error: "subject, kind, and expiresAt are required" }, { status: 400 });
    }
    if (Number.isNaN(new Date(body.expiresAt).getTime())) {
      return NextResponse.json({ error: "expiresAt must be a valid date (YYYY-MM-DD)" }, { status: 400 });
    }

    const [created] = await db
      .insert(complianceDocuments)
      .values({
        businessProfileId: profile.id,
        subject: String(body.subject),
        kind: String(body.kind),
        expiresAt: String(body.expiresAt).slice(0, 10),
        documentUrl: body.documentUrl ?? null,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Create compliance document error:", err);
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
      .from(complianceDocuments)
      .where(and(eq(complianceDocuments.id, id), eq(complianceDocuments.businessProfileId, profile.id)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const [updated] = await db
      .update(complianceDocuments)
      .set({
        subject: body.subject ?? existing.subject,
        kind: body.kind ?? existing.kind,
        expiresAt: body.expiresAt ? String(body.expiresAt).slice(0, 10) : existing.expiresAt,
        documentUrl: body.documentUrl !== undefined ? body.documentUrl : existing.documentUrl,
        updatedAt: new Date(),
      })
      .where(eq(complianceDocuments.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Update compliance document error:", err);
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
      .delete(complianceDocuments)
      .where(and(eq(complianceDocuments.id, id), eq(complianceDocuments.businessProfileId, profile.id)))
      .returning();

    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete compliance document error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
