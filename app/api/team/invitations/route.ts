import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import crypto from "crypto";
import { db } from "@/lib/db";
import { businessProfiles, teamInvitations, teamRoles } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { sendInvitationEmail } from "@/lib/email";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { businessProfileId, email, name, roleId, role, expiresInDays = 7 } = await req.json();

    if (!businessProfileId || !email || !name) {
      return NextResponse.json(
        { error: "businessProfileId, email and name are required" },
        { status: 400 }
      );
    }

    const [profile] = await db
      .select()
      .from(businessProfiles)
      .where(and(eq(businessProfiles.id, businessProfileId), eq(businessProfiles.userId, user.id)))
      .limit(1);

    if (!profile) {
      return NextResponse.json({ error: "Business profile not found or not owned by user" }, { status: 404 });
    }

    let resolvedRoleId = roleId ?? null;
    if (!resolvedRoleId && role) {
      const [roleRecord] = await db
        .select()
        .from(teamRoles)
        .where(and(eq(teamRoles.businessProfileId, businessProfileId), eq(teamRoles.name, String(role))))
        .limit(1);

      resolvedRoleId = roleRecord?.id ?? null;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const [invitation] = await db
      .insert(teamInvitations)
      .values({
        businessProfileId,
        email,
        name,
        role: role ?? "viewer",
        roleId: resolvedRoleId,
        token,
        status: "pending",
        invitedBy: user.id,
        createdBy: user.id,
        expiresAt,
      })
      .returning();

    const acceptLink = `${process.env.APP_URL ?? "http://localhost:3000"}/accept-invitation?token=${token}`;

    await sendInvitationEmail({
      to: email,
      name,
      inviterName: user.name || user.email,
      businessName: profile.businessName,
      acceptLink,
      role: invitation.role,
    }).catch((err) => console.warn("Invitation email skip/failed:", err));

    await createAuditLog({
      actorUserId: user.id,
      businessProfileId,
      teamInvitationId: invitation.id,
      targetUserId: null,
      action: "invited",
      resourceType: "team_invitation",
      resourceId: invitation.id,
      details: { email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString() },
    });

    return NextResponse.json(invitation, { status: 201 });
  } catch (error) {
    console.error("Create team invitation error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const businessProfileId = Number(searchParams.get("businessProfileId"));

    if (!businessProfileId) {
      return NextResponse.json({ error: "businessProfileId is required" }, { status: 400 });
    }

    const [profile] = await db
      .select()
      .from(businessProfiles)
      .where(and(eq(businessProfiles.id, businessProfileId), eq(businessProfiles.userId, user.id)))
      .limit(1);

    if (!profile) {
      return NextResponse.json({ error: "Business profile not found or not owned by user" }, { status: 404 });
    }

    const invitations = await db
      .select()
      .from(teamInvitations)
      .where(eq(teamInvitations.businessProfileId, businessProfileId));

    return NextResponse.json(invitations);
  } catch (error) {
    console.error("Get team invitations error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
