import { NextRequest, NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { payouts } from "@/drizzle/schema";
import { getPlatformUser } from "@/lib/admin";
import { retryOpenPayouts } from "@/lib/payouts";

/**
 * Platform view of ticket money.
 *  GET  /api/admin/payouts — latest payouts and Lumticket's commission totals
 *  POST /api/admin/payouts — retry every payout that failed or was waiting for payout details
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const rows = await db.select().from(payouts).orderBy(desc(payouts.createdAt)).limit(200);
    const [totals] = await db.execute<{ gross: string; commission: string; net: string; open: string }>(sql`
      SELECT COALESCE(SUM(gross_amount),0)::text AS gross, COALESCE(SUM(commission_amount),0)::text AS commission,
             COALESCE(SUM(net_amount),0)::text AS net,
             COUNT(*) FILTER (WHERE status NOT IN ('sent','paid'))::text AS open
      FROM payouts`);
    return NextResponse.json({ totals, payouts: rows });
  } catch (err) {
    console.error("Admin list payouts error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(await retryOpenPayouts());
  } catch (err) {
    console.error("Admin retry payouts error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
