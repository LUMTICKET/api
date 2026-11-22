import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth-kyb";
import { platformAuditLog } from "@/drizzle/schema";
import { ensureOperationalSchema } from "@/lib/ensure-schema";

/**
 * Platform-staff gate.
 *
 * A user passes when they hold at least one platform role
 * (user_platform_roles). While no roles have been assigned to anyone yet
 * (fresh install), every authenticated user passes so the admin endpoints
 * are usable out of the box; tighten by assigning roles then setting
 * ADMIN_STRICT=1.
 */
export async function getPlatformUser(req: NextRequest) {
  await ensureOperationalSchema();

  const user = await getCurrentUser(req);
  if (!user) return null;

  const assignedRows = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM "user_platform_roles"`
  );
  const assignedRoles = Number(assignedRows[0]?.count ?? 0);
  if (assignedRoles === 0 && process.env.ADMIN_STRICT !== "1") {
    return user;
  }

  const membershipRows = await db.execute<{ id: number }>(
    sql`SELECT id FROM "user_platform_roles" WHERE "user_id" = ${user.id} LIMIT 1`
  );

  return membershipRows.length > 0 ? user : null;
}

/** Writes a platform-level audit entry (actor is an email string). */
export async function createPlatformAudit(
  actor: string,
  action: string,
  target?: string
) {
  await db.insert(platformAuditLog).values({ actor, action, target: target ?? null });
}
