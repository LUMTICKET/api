import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { teamInvitations, teamMembers } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { createAuditLog } from "@/lib/audit";

interface Params {
  params: Promise<{ token: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { token } = await params;
    const [invitation] = await db
      .select()
      .from(teamInvitations)
      .where(and(eq(teamInvitations.token, token), eq(teamInvitations.status, "pending")))
      .limit(1);

    if (!invitation) {
      return NextResponse.json({ error: "Invitation not found or expired" }, { status: 404 });
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      await db
        .update(teamInvitations)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(teamInvitations.id, invitation.id));

      return NextResponse.json({ error: "Invitation expired" }, { status: 410 });
    }

    return NextResponse.json(invitation);
  } catch (error) {
    console.error("Get invitation token error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { token } = await params;
    const [invitation] = await db
      .select()
      .from(teamInvitations)
      .where(and(eq(teamInvitations.token, token), eq(teamInvitations.status, "pending")))
      .limit(1);

    if (!invitation) {
      return NextResponse.json({ error: "Invitation not found or expired" }, { status: 404 });
    }

    if (new Date(invitation.expiresAt) < new Date()) {
      await db
        .update(teamInvitations)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(teamInvitations.id, invitation.id));
      return NextResponse.json({ error: "Invitation expired" }, { status: 410 });
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

    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    console.error("Accept invitation error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
