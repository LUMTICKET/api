import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs } from "@/drizzle/schema";

export async function createAuditLog(input: {
  actorUserId?: number | null;
  targetUserId?: number | null;
  businessProfileId?: number | null;
  teamRoleId?: number | null;
  teamInvitationId?: number | null;
  action: string;
  resourceType: string;
  resourceId?: number | null;
  details?: Record<string, unknown>;
}) {
  const [log] = await db
    .insert(auditLogs)
    .values({
      actorUserId: input.actorUserId ?? null,
      targetUserId: input.targetUserId ?? null,
      businessProfileId: input.businessProfileId ?? null,
      teamRoleId: input.teamRoleId ?? null,
      teamInvitationId: input.teamInvitationId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      details: input.details ?? {},
    })
    .returning();

  return log;
}

export async function getAuditLogsForBusiness(businessProfileId: number) {
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.businessProfileId, businessProfileId))
    .orderBy(auditLogs.createdAt);
}

export async function getAuditLogsForUser(userId: number) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.actorUserId, userId), eq(auditLogs.targetUserId, userId)))
    .orderBy(auditLogs.createdAt);
}
