import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teamInvitations, teamMembers, businessProfiles, users } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { email, name, role } = body;

    if (!email || !name || !role) {
      return NextResponse.json(
        { error: "Email, name, and role are required" },
        { status: 400 }
      );
    }

    // Get the user's business profile
    const [profile] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.userId, user.id))
      .limit(1);

    if (!profile) {
      return NextResponse.json(
        { error: "Business profile not found" },
        { status: 404 }
      );
    }

    // Check if user already has a team member with this email
    const existingMember = await db
      .select()
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(
        and(
          eq(teamMembers.businessProfileId, profile.id),
          eq(users.email, email)
        )
      )
      .limit(1);

    if (existingMember.length > 0) {
      return NextResponse.json(
        { error: "User is already a team member" },
        { status: 409 }
      );
    }

    // Check for pending invitation
    const pendingInvitation = await db
      .select()
      .from(teamInvitations)
      .where(
        and(
          eq(teamInvitations.businessProfileId, profile.id),
          eq(teamInvitations.email, email),
          eq(teamInvitations.status, "pending")
        )
      )
      .limit(1);

    if (pendingInvitation.length > 0) {
      return NextResponse.json(
        { error: "Invitation already sent to this email" },
        { status: 409 }
      );
    }

    // Generate invitation token
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

    const [invitation] = await db
      .insert(teamInvitations)
      .values({
        businessProfileId: profile.id,
        email,
        name,
        role,
        token,
        status: "pending",
        invitedBy: user.id,
        expiresAt,
      })
      .returning();

    // TODO: Send email invitation with accept link
    // const acceptLink = `${process.env.APP_URL}/team/accept?token=${token}`;
    // await sendInvitationEmail(email, name, profile.businessName, acceptLink);

    return NextResponse.json({
      message: "Invitation sent successfully",
      invitation: {
        id: invitation.id,
        email: invitation.email,
        name: invitation.name,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
        status: invitation.status,
      },
    });
  } catch (err) {
    console.error("Invitation error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}