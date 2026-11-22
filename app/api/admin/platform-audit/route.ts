import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { platformAuditLog } from "@/drizzle/schema";
import { getPlatformUser } from "@/lib/admin";
import { ensureOperationalSchema } from "@/lib/ensure-schema";

/**
 * Platform audit log (staff PlatformAuditPanel).
 * GET /api/admin/platform-audit — entries, newest first (limit 200).
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rows = await db
      .select()
      .from(platformAuditLog)
      .orderBy(desc(platformAuditLog.occurredAt))
      .limit(200);

    return NextResponse.json({ entries: rows });
  } catch (err) {
    console.error("List platform audit error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
