import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { teamInvitations, teamMembers, users } from "@/drizzle/schema";
import type { TeamInvitation } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import {
  hashPassword,
  isStrongEnoughPassword,
  isValidEmail,
  isValidPhone,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  normalizePhone,
  startSessionForUser,
} from "@/lib/auth";
import { ensureAuthSchema } from "@/lib/ensure-auth-schema";
import { allocateBusinessId, buildAuthUser } from "@/lib/identity";
import { createAuditLog } from "@/lib/audit";

interface Params {
  params: Promise<{ token: string }>;
}

interface InvitationBody {
  password?: unknown;
  name?: unknown;
  phone?: unknown;
}

type LoadResult =
  | { invitation: TeamInvitation; error: null }
  | { invitation: null; error: { status: number; message: string } };

/** Loads a pending, unexpired invitation (marking stale ones expired). */
async function loadInvitation(token: string): Promise<LoadResult> {
  const [invitation] = await db
    .select()
    .from(teamInvitations)
    .where(and(eq(teamInvitations.token, token), eq(teamInvitations.status, "pending")))
    .limit(1);

  if (!invitation) {
    return {
      invitation: null,
      error: { status: 404, message: "Invitation not found or expired" },
    };
  }

  if (new Date(invitation.expiresAt) < new Date()) {
    await db
      .update(teamInvitations)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(teamInvitations.id, invitation.id));
    return {
      invitation: null,
      error: { status: 410, message: "Invitation expired" },
    };
  }

  return { invitation, error: null };
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { token } = await params;
    const result = await loadInvitation(token);
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.status });
    }
    return NextResponse.json(result.invitation);
  } catch (error) {
    console.error("Get invitation token error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * POST /api/team/invitations/:token
 *
 * Two accepted shapes:
 *
 * 1. Credentials creation (public — the emailed token is the secret):
 *    `{ password, name?, phone? }`. Creates the invited person's account in
 *    `users` with the invitation email as a login identifier, links it to the
 *    business (`isInBusiness: true`, `businessProfileId`), records the
 *    `team_members` row with the invited role, marks the invitation accepted
 *    and returns a session — so the new member lands on the dashboard already
 *    signed in with their role.
 *
 * 2. Legacy accept (bearer token): no `password` in the body; the invited
 *    person signs in with their own existing account first.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    await ensureAuthSchema();

    const { token } = await params;
    const body = (await req.json().catch(() => ({}))) as InvitationBody;

    const result = await loadInvitation(token);
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: result.error.status });
    }
    const invitation = result.invitation;

    if (body.password !== undefined && body.password !== null) {
      return acceptWithCredentials(req, invitation, body);
    }

    return acceptWithSession(req, invitation);
  } catch (error) {
    console.error("Accept invitation error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/** Invitation approval that mints login credentials for the invited person. */
async function acceptWithCredentials(
  req: NextRequest,
  invitation: TeamInvitation,
  body: InvitationBody
) {
  if (!isStrongEnoughPassword(body.password)) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 }
    );
  }

  const email = normalizeEmail(invitation.email);
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Invitation email is not a valid address" },
      { status: 400 }
    );
  }

  const rawPhone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (rawPhone && !isValidPhone(rawPhone)) {
    return NextResponse.json(
      { error: "Enter a valid phone number" },
      { status: 400 }
    );
  }
  const phone = rawPhone ? normalizePhone(rawPhone) : null;

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (existingUser) {
    return NextResponse.json(
      { error: "Account already exists. Sign in to accept this invitation." },
      { status: 409 }
    );
  }

  if (phone) {
    const [existingPhone] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1);
    if (existingPhone) {
      return NextResponse.json({ error: "Phone already registered" }, { status: 409 });
    }
  }

  const hashed = await hashPassword(String(body.password));
  const businessId = await allocateBusinessId();
  const invitedName =
    typeof body.name === "string" && body.name.trim() ? body.name.trim() : invitation.name;

  const [user] = await db
    .insert(users)
    .values({
      email,
      phone,
      password: hashed,
      name: invitedName,
      businessId,
      isInBusiness: true,
      businessProfileId: invitation.businessProfileId,
    })
    .returning();

  const [member] = await db
    .insert(teamMembers)
    .values({
      businessProfileId: invitation.businessProfileId,
      userId: user.id,
      role: invitation.role,
      roleId: invitation.roleId,
      invitationId: invitation.id,
    })
    .returning();

  await db
    .update(teamInvitations)
    .set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(teamInvitations.id, invitation.id));

  await createAuditLog({
    actorUserId: user.id,
    targetUserId: user.id,
    businessProfileId: invitation.businessProfileId,
    teamInvitationId: invitation.id,
    action: "accepted",
    resourceType: "team_member",
    resourceId: member.id,
    details: {
      teamRole: invitation.role,
      credentialsCreated: true,
      loginIdentifiers: ["email", "phone", "businessId"],
    },
  });

  const session = await startSessionForUser(user, req);
  return NextResponse.json(
    {
      ...session,
      user: await buildAuthUser(user),
      member,
      nextStep: "dashboard",
    },
    { status: 201 }
  );
}

/** Legacy flow: the invited person already has an account and is signed in. */
async function acceptWithSession(req: NextRequest, invitation: TeamInvitation) {
  const user = await getCurrentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [existingMember] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id))
    .limit(1);

  if (existingMember) {
    return NextResponse.json({ error: "User already belongs to a team" }, { status: 409 });
  }

  const [member] = await db
    .insert(teamMembers)
    .values({
      businessProfileId: invitation.businessProfileId,
      userId: user.id,
      role: invitation.role,
      roleId: invitation.roleId,
      invitationId: invitation.id,
    })
    .returning();

  await db
    .update(teamInvitations)
    .set({ status: "accepted", acceptedAt: new Date(), updatedAt: new Date() })
    .where(eq(teamInvitations.id, invitation.id));

  // Identify the account with the business it just joined.
  const [updatedUser] = await db
    .update(users)
    .set({
      isInBusiness: true,
      businessProfileId: invitation.businessProfileId,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id))
    .returning();

  await createAuditLog({
    actorUserId: user.id,
    businessProfileId: invitation.businessProfileId,
    targetUserId: user.id,
    teamInvitationId: invitation.id,
    action: "accepted",
    resourceType: "team_member",
    resourceId: member.id,
    details: { teamRole: invitation.role },
  });

  return NextResponse.json(
    {
      ...member,
      user: await buildAuthUser(updatedUser ?? user),
    },
    { status: 201 }
  );
}
