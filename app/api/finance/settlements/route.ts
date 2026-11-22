import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settlements } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId } from "@/lib/ownership";

/**
 * Finance & settlements (every business role's FinancePanel).
 * GET /api/finance/settlements — settlements for the owned profile,
 * newest period first. Optionally filter with ?status=pending|paid.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const status = new URL(req.url).searchParams.get("status");
    if (status && status !== "pending" && status !== "paid") {
      return NextResponse.json({ error: "status must be pending or paid" }, { status: 400 });
    }

    const typedStatus = status as "pending" | "paid";
    const rows = await db
      .select()
      .from(settlements)
      .where(
        status
          ? and(eq(settlements.businessProfileId, profile.id), eq(settlements.status, typedStatus))
          : eq(settlements.businessProfileId, profile.id)
      )
      .orderBy(desc(settlements.periodStart));

    return NextResponse.json({ settlements: rows });
  } catch (err) {
    console.error("List settlements error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
