import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, teamMembers, teamRoles, users } from "@/drizzle/schema";
import type { User } from "@/drizzle/schema";
import {
  getBusinessTypeForUser,
  serializeBusinessType,
} from "@/lib/business-types";

/** Roles an account can hold inside a business. `owner` is implicit. */
export type AccountRole = "owner" | "admin" | "operator" | "viewer";

export interface UserIdentity {
  isInBusiness: boolean;
  businessProfileId: number | null;
  businessName: string | null;
  role: AccountRole | null;
  permissions: string[];
}

const BUSINESS_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Candidate Business ID, e.g. LMT-8F3K2QZ4 (unique per account). */
export function generateBusinessIdCandidate(): string {
  let suffix = "";
  for (let i = 0; i < 8; i += 1) {
    suffix += BUSINESS_ID_ALPHABET[crypto.randomInt(BUSINESS_ID_ALPHABET.length)];
  }
  return `LMT-${suffix}`;
}

/** Allocates a Business ID that no other account already uses. */
export async function allocateBusinessId(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateBusinessIdCandidate();
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.businessId, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  throw new Error("Could not allocate a unique Business ID");
}

/**
 * Resolves which business an account belongs to and which role it holds
 * there. Owners are identified by the profile they created; team members by
 * their accepted `team_members` row (role + custom role permissions).
 */
export async function getIdentityForUser(user: User): Promise<UserIdentity> {
  const [owned] = await db
    .select()
    .from(businessProfiles)
    .where(eq(businessProfiles.userId, user.id))
    .limit(1);

  const [membership] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id))
    .limit(1);

  const businessProfileId =
    user.businessProfileId ?? owned?.id ?? membership?.businessProfileId ?? null;

  let role: AccountRole | null = null;
  let permissions: string[] = [];

  if (owned && (businessProfileId === null || businessProfileId === owned.id)) {
    role = "owner";
    permissions = ["*"];
  } else if (membership) {
    role = membership.role;
    if (membership.roleId) {
      const [roleRecord] = await db
        .select()
        .from(teamRoles)
        .where(eq(teamRoles.id, membership.roleId))
        .limit(1);
      permissions = roleRecord?.permissions ?? [];
    }
  }

  let businessName: string | null = null;
  if (businessProfileId) {
    const [profile] = await db
      .select({ businessName: businessProfiles.businessName })
      .from(businessProfiles)
      .where(eq(businessProfiles.id, businessProfileId))
      .limit(1);
    businessName = profile?.businessName ?? null;
  }

  return {
    isInBusiness: Boolean(user.isInBusiness || owned || membership),
    businessProfileId,
    businessName,
    role,
    permissions,
  };
}

/**
 * The shared `user` payload returned by every auth endpoint. Includes the
 * login identifiers, the business linkage (`isInBusiness` / which business)
 * and the role the account signs in with.
 */
export async function buildAuthUser(user: User) {
  const [businessType, identity] = await Promise.all([
    getBusinessTypeForUser(user.id),
    getIdentityForUser(user),
  ]);

  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    name: user.name,
    avatar: user.avatar,
    businessId: user.businessId,
    twoFactorEnabled: user.twoFactorEnabled,
    isInBusiness: identity.isInBusiness,
    businessProfileId: identity.businessProfileId,
    businessName: identity.businessName,
    role: identity.role,
    permissions: identity.permissions,
    businessType: serializeBusinessType(businessType),
  };
}
