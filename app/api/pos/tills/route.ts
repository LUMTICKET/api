import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { posTransactions, tillSessions } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId, parseId } from "@/lib/ownership";

/**
 * Agent till sessions (Today's till / End of day panels).
 * POST /api/pos/tills — open a till ({openingFloat, limitAmount?, currency?}).
 *   Fails with 409 when a till is already open.
 * GET /api/pos/tills — current open till + today's totals (today's cash and
 *   mobile sales summed from pos_transactions, plus session history).
 * PUT /api/pos/tills?id=<id> — close the till; stores the cash/mobile totals
 *   computed from the transactions made while it was open.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const [openTill] = await db
      .select({ id: tillSessions.id })
      .from(tillSessions)
      .where(and(eq(tillSessions.agentProfileId, profile.id), isNull(tillSessions.closedAt)))
      .limit(1);
    if (openTill) {
      return NextResponse.json({ error: "A till session is already open" }, { status: 409 });
    }

    const body = await req.json();
    const [created] = await db
      .insert(tillSessions)
      .values({
        agentProfileId: profile.id,
        openingFloat: Number.isInteger(Number(body.openingFloat)) ? Number(body.openingFloat) : 0,
        limitAmount: body.limitAmount !== undefined && body.limitAmount !== null ? Number(body.limitAmount) : null,
        currency: String(body.currency ?? "MWK").toUpperCase().slice(0, 3),
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Open till error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [totals] = await db
      .select({
        cashSales: sql<number>`COALESCE(SUM(CASE WHEN "method" = 'cash' THEN "amount" ELSE 0 END), 0)::int`,
        mobileSales: sql<number>`COALESCE(SUM(CASE WHEN "method" = 'mobile-money' THEN "amount" ELSE 0 END), 0)::int`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(posTransactions)
      .where(and(eq(posTransactions.agentProfileId, profile.id), gte(posTransactions.occurredAt, startOfDay)));

    const [openTill] = await db
      .select()
      .from(tillSessions)
      .where(and(eq(tillSessions.agentProfileId, profile.id), isNull(tillSessions.closedAt)))
      .orderBy(desc(tillSessions.openedAt))
      .limit(1);

    const history = await db
      .select()
      .from(tillSessions)
      .where(eq(tillSessions.agentProfileId, profile.id))
      .orderBy(desc(tillSessions.openedAt))
      .limit(30);

    return NextResponse.json({
      current: openTill ?? null,
      today: totals,
      history,
    });
  } catch (err) {
    console.error("Get till error:", err);
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
      .from(tillSessions)
      .where(and(eq(tillSessions.id, id), eq(tillSessions.agentProfileId, profile.id)))
      .limit(1);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.closedAt) return NextResponse.json({ error: "Till already closed" }, { status: 409 });

    // Compute the session totals from transactions since it was opened.
    const [totals] = await db
      .select({
        cashSales: sql<number>`COALESCE(SUM(CASE WHEN "method" = 'cash' THEN "amount" ELSE 0 END), 0)::int`,
        mobileSales: sql<number>`COALESCE(SUM(CASE WHEN "method" = 'mobile-money' THEN "amount" ELSE 0 END), 0)::int`,
      })
      .from(posTransactions)
      .where(
        and(
          eq(posTransactions.agentProfileId, profile.id),
          gte(posTransactions.occurredAt, existing.openedAt)
        )
      );

    const [updated] = await db
      .update(tillSessions)
      .set({
        closedAt: new Date(),
        cashSales: totals?.cashSales ?? 0,
        mobileSales: totals?.mobileSales ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(tillSessions.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Close till error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
