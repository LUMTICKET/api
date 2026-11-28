import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, teamMembers } from "@/drizzle/schema";

/** Returns the business profile when owned by the user, else null. */
export async function getOwnedProfile(profileId: number, userId: number) {
  const [profile] = await db
    .select()
    .from(businessProfiles)
    .where(and(eq(businessProfiles.id, profileId), eq(businessProfiles.userId, userId)))
    .limit(1);
  return profile ?? null;
}

/**
 * Returns the business profile when the user owns it OR is an admin on its team, else null.
 * Used for money actions (paying the publishing fee, republishing) so a team admin can do what
 * the owner can, matching who may already edit / delete the same events.
 */
export async function getManagedProfile(profileId: number, userId: number) {
  const owned = await getOwnedProfile(profileId, userId);
  if (owned) return owned;
  const [membership] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.businessProfileId, profileId), eq(teamMembers.userId, userId), eq(teamMembers.role, "admin")))
    .limit(1);
  if (!membership) return null;
  const [profile] = await db.select().from(businessProfiles).where(eq(businessProfiles.id, profileId)).limit(1);
  return profile ?? null;
}

/** Returns the user's business profile (there is one profile per user), else null. */
export async function getProfileByUserId(userId: number) {
  const [profile] = await db
    .select()
    .from(businessProfiles)
    .where(eq(businessProfiles.userId, userId))
    .limit(1);
  return profile ?? null;
}

/** Parses an id from a dynamic route param. */
export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Generates a unique-enough human reference like LMT-R1-K3X9QZ. */
export function makeReference(prefix: string) {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `LMT-${prefix}-${rand}`;
}
