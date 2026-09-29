import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { posTransactions } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId, makeReference } from "@/lib/ownership";

const kinds = ["bus-ticket", "parcel", "event-ticket"] as const;
const methods = ["cash", "mobile-money"] as const;

/**
 * Agent POS transactions (Sell & register / Transactions panels).
 * GET /api/pos/transactions — agent's transactions, newest first
 * POST /api/pos/transactions — {kind required, amount required, method?, reference?, occurredAt?}
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
      .from(posTransactions)
      .where(eq(posTransactions.agentProfileId, profile.id))
      .orderBy(desc(posTransactions.occurredAt))
      .limit(200);

    return NextResponse.json({ transactions: rows });
  } catch (err) {
    console.error("List POS transactions error:", err);
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
    const kind = body.kind;
    if (!kinds.includes(kind)) {
      return NextResponse.json({ error: "kind must be bus-ticket, parcel, or event-ticket" }, { status: 400 });
    }
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount < 0) {
      return NextResponse.json({ error: "amount must be a non-negative integer (minor units)" }, { status: 400 });
    }
    const method = body.method ?? "cash";
    if (!methods.includes(method)) {
      return NextResponse.json({ error: "method must be cash or mobile-money" }, { status: 400 });
    }

    const [created] = await db
      .insert(posTransactions)
      .values({
        agentProfileId: profile.id,
        kind,
        reference: body.reference ?? makeReference("POS"),
        amount,
        currency: String(body.currency ?? "MWK").toUpperCase().slice(0, 3),
        method,
        occurredAt:
          body.occurredAt && !Number.isNaN(new Date(body.occurredAt).getTime())
            ? new Date(body.occurredAt)
            : new Date(),
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Create POS transaction error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
