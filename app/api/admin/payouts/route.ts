import { NextRequest, NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { payouts } from "@/drizzle/schema";
import { getPlatformUser } from "@/lib/admin";
import { retryOpenPayouts } from "@/lib/payouts";

/**
 * Platform view of ticket money.
 *  GET  /api/admin/payouts — latest payouts and what Lumticket (the system owners) has earned:
 *       platformCommission (commission paid to us on ticket sales) + publishingFees (listing / republish fees)
 *  POST /api/admin/payouts — retry every payout that failed or was waiting for payout details
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const rows = await db.select().from(payouts).orderBy(desc(payouts.createdAt)).limit(200);
    const [totals] = await db.execute<{ gross: string; commission: string; net: string; open: string; publishing_fees: string }>(sql`
      SELECT COALESCE(SUM(gross_amount),0)::text AS gross, COALESCE(SUM(commission_amount),0)::text AS commission,
             COALESCE(SUM(net_amount),0)::text AS net,
             COUNT(*) FILTER (WHERE status NOT IN ('sent','paid'))::text AS open,
             (SELECT COALESCE(SUM(amount),0)::text FROM payments
               WHERE status = 'succeeded' AND metadata->>'paymentType' = 'publishing-fee'
                 AND COALESCE(metadata->>'reversed','false') <> 'true') AS publishing_fees
      FROM payouts`);
    const platformCommission = Number(totals?.commission ?? 0);
    const publishingFees = Number(totals?.publishing_fees ?? 0);
    return NextResponse.json({
      // `commission` kept for older clients; platformCommission is the same number, named for who receives it.
      totals: { ...totals, platformCommission, publishingFees, platformRevenue: platformCommission + publishingFees },
      payouts: rows,
    });

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
