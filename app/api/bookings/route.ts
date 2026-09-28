import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookings } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";

const kinds = ["bus", "event", "parcel"] as const;
const statuses = ["upcoming", "completed", "in-transit", "delivered", "cancelled"] as const;

/**
 * GET /api/bookings — the authenticated user's bookings (all kinds).
 * POST /api/bookings — records a booking row (used by bus checkout and
 * parcel send flows to power /bookings and /account).
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.userId, user.id))
      .orderBy(desc(bookings.scheduledFor));

    return NextResponse.json({ bookings: rows });
  } catch (err) {
    console.error("List bookings error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    if (!body.kind || !kinds.includes(body.kind) || !body.title || !body.scheduledFor) {
      return NextResponse.json(
        { error: `kind (${kinds.join("|")}), title, and scheduledFor are required` },
        { status: 400 }
      );
    }
    const status = body.status ?? "upcoming";
    if (!statuses.includes(status)) {
      return NextResponse.json({ error: `status must be one of ${statuses.join("|")}` }, { status: 400 });
    }

    const [created] = await db
      .insert(bookings)
      .values({
        userId: user.id,
        kind: body.kind,
        reference: body.reference ?? `LMT-${String(body.kind).slice(0, 3).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        title: String(body.title),
        detail: body.detail ?? null,
        scheduledFor: new Date(body.scheduledFor),
        amount: Number.isInteger(Number(body.amount)) ? Number(body.amount) : 0,
        currency: String(body.currency ?? "MWK").toUpperCase().slice(0, 3),
        status,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Create booking error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
