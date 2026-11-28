import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payouts } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId } from "@/lib/ownership";
import { refreshPayoutStatus } from "@/lib/payouts";

/** GET /api/finance/payouts — the organiser's own ticket payouts: gross, the commission paid to Lumticket (the platform owners), and what they were sent. */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    let rows = await db.select().from(payouts).where(eq(payouts.businessProfileId, profile.id)).orderBy(desc(payouts.createdAt)).limit(200);
    rows = await Promise.all(rows.map((r) => (r.status === "sent" ? refreshPayoutStatus(r) : r)));
    return NextResponse.json({ payouts: rows.map(({ lastError: _e, ...r }) => ({ ...r, commissionPaidToPlatform: r.commissionAmount })) });
  } catch (err) {
    console.error("List payouts error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
