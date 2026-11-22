import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { supportCases } from "@/drizzle/schema";
import { createPlatformAudit, getPlatformUser } from "@/lib/admin";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { parseId } from "@/lib/ownership";

const kinds = ["bus", "event", "parcel"] as const;
const statuses = ["open", "waiting", "resolved"] as const;

/**
 * Support console (staff SupportConsolePanel).
 * GET /api/admin/support-cases — list with optional ?status= / ?kind= filters.
 * POST /api/admin/support-cases — {customerName, subject required, reference?, kind?}.
 * PATCH /api/admin/support-cases?id=<id> — {status} moves the case.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const params = new URL(req.url).searchParams;
    const status = params.get("status");
    const kind = params.get("kind");
    if (status && !(statuses as readonly string[]).includes(status)) {
      return NextResponse.json({ error: "status must be open, waiting, or resolved" }, { status: 400 });
    }
    if (kind && !(kinds as readonly string[]).includes(kind)) {
      return NextResponse.json({ error: "kind must be bus, event, or parcel" }, { status: 400 });
    }

    let rows;
    if (status && kind) {
      rows = await db
        .select()
        .from(supportCases)
        .where(
          and(
            eq(supportCases.status, status as "open" | "waiting" | "resolved"),
            eq(supportCases.kind, kind as "bus" | "event" | "parcel")
          )
        )
        .orderBy(desc(supportCases.openedAt))
        .limit(200);
    } else if (status) {
      rows = await db
        .select()
        .from(supportCases)
        .where(eq(supportCases.status, status as "open" | "waiting" | "resolved"))
        .orderBy(desc(supportCases.openedAt))
        .limit(200);
    } else if (kind) {
      rows = await db
        .select()
        .from(supportCases)
        .where(eq(supportCases.kind, kind as "bus" | "event" | "parcel"))
        .orderBy(desc(supportCases.openedAt))
        .limit(200);
    } else {
      rows = await db.select().from(supportCases).orderBy(desc(supportCases.openedAt)).limit(200);
    }

    return NextResponse.json({ cases: rows });
  } catch (err) {
    console.error("List support cases error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    if (!body.customerName || !body.subject) {
      return NextResponse.json({ error: "customerName and subject are required" }, { status: 400 });
    }
    const kind = body.kind ?? "bus";
    if (!kinds.includes(kind)) {
      return NextResponse.json({ error: "kind must be bus, event, or parcel" }, { status: 400 });
    }

    const [created] = await db
      .insert(supportCases)
      .values({
        reference: body.reference ?? null,
        customerName: String(body.customerName),
        subject: String(body.subject),
        kind,
        status: statuses.includes(body.status) ? body.status : "open",
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Create support case error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = parseId(new URL(req.url).searchParams.get("id") ?? "");
    if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

    const body = await req.json();
    const status = body.status;
    if (!statuses.includes(status)) {
      return NextResponse.json({ error: "status must be open, waiting, or resolved" }, { status: 400 });
    }

    const [updated] = await db
      .update(supportCases)
      .set({ status, updatedAt: new Date() })
      .where(eq(supportCases.id, id))
      .returning();

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await createPlatformAudit(
      user.email ?? `user-${user.id}`,
      `Support case → ${status}`,
      `case/${updated.reference ?? updated.id}`
    );

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Update support case error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
