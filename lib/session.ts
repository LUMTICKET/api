import crypto from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions } from "@/drizzle/schema";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function createSession(
  userId: number,
  email: string,
  metadata?: {
    userAgent?: string | null;
    ipAddress?: string | null;
  }
) {
  const now = new Date();
  const sessionId = crypto.randomUUID();
  const refreshToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS);

  const [record] = await db
    .insert(sessions)
    .values({
      userId,
      email,
      sessionId,
      refreshTokenHash: hashToken(refreshToken),
      userAgent: metadata?.userAgent ?? null,
      ipAddress: metadata?.ipAddress ?? null,
      expiresAt,
      refreshExpiresAt,
      revokedAt: null,
    })
    .returning();

  return {
    sessionId,
    refreshToken,
    expiresAt: expiresAt.toISOString(),
    refreshExpiresAt: refreshExpiresAt.toISOString(),
    record,
  };
}

export async function getSession(sessionId?: string) {
  if (!sessionId) return null;

  const [record] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.sessionId, sessionId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1);

  return record ?? null;
}

export async function revokeSession(sessionId?: string) {
  if (!sessionId) return false;

  const [updated] = await db
    .update(sessions)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(sessions.sessionId, sessionId))
    .returning();

  return Boolean(updated);
}

export async function getSessionByRefreshToken(refreshToken: string) {
  if (!refreshToken) return null;

  const refreshTokenHash = hashToken(refreshToken);
  const [record] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.refreshTokenHash, refreshTokenHash),
        isNull(sessions.revokedAt),
        gt(sessions.refreshExpiresAt, new Date())
      )
    )
    .limit(1);

  if (!record) return null;

  return record;
}

export async function rotateSession(refreshToken: string) {
  const record = await getSessionByRefreshToken(refreshToken);
  if (!record) return null;

  const newRefreshToken = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TTL_MS);

  const [updated] = await db
    .update(sessions)
    .set({
      refreshTokenHash: hashToken(newRefreshToken),
      refreshExpiresAt,
      updatedAt: now,
    })
    .where(eq(sessions.id, record.id))
    .returning();

  if (!updated) return null;

  return {
    sessionId: updated.sessionId,
    userId: updated.userId,
    email: updated.email,
    refreshToken: newRefreshToken,
    refreshExpiresAt: refreshExpiresAt.toISOString(),
    expiresAt: updated.expiresAt.toISOString(),
  };
}

export async function getActiveUserSession(userId: number) {
  const [record] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1);

  return record ?? null;
}
