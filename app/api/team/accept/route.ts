import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teamInvitations, teamMembers, users } from "@/drizzle/schema";
import { hashPassword } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token: invitationToken, password, confirmPassword } = body;

    if (!invitationToken) {
      return NextResponse.json(
        { error: "Invitation token is required" },
        { status: 400 }
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: "Passwords do not match" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // Find valid invitation
    const [invitation] = await db
      .select()
      .from(teamInvitations)
      .where(
        and(
          eq(teamInvitations.token, invitationToken),
          eq(teamInvitations.status, "pending")
        )
      )
      .limit(1);

    if (!invitation) {
      return NextResponse.json(
        { error: "Invalid or expired invitation" },
        { status: 404 }
      );
    }

    // Check if expired
    if (new Date() > invitation.expiresAt) {
      await db
        .update(teamInvitations)
        .set({ status: "expired" })
        .where(eq(teamInvitations.id, invitation.id));

      return NextResponse.json(
        { error: "Invitation has expired" },
        { status: 410 }
      );
    }

    // Check if user already exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, invitation.email))
      .limit(1);

    let userId: number;

    if (existingUser) {
      userId = existingUser.id;

      // Check if already a team member
      const [existingMember] = await db
        .select()
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.businessProfileId, invitation.businessProfileId),
            eq(teamMembers.userId, userId)
          )
        )
        .limit(1);

      if (existingMember) {
        return NextResponse.json(
          { error: "You are already a team member" },
          { status: 409 }
        );
      }
    } else {
      // Create new user
      const hashedPassword = await hashPassword(password);
      const [newUser] = await db
        .insert(users)
        .values({
          email: invitation.email,
          password: hashedPassword,
          name: invitation.name,
        })
        .returning();
      userId = newUser.id;
    }

    // Create team member
    const [teamMember] = await db
      .insert(teamMembers)
      .values({
        businessProfileId: invitation.businessProfileId,
        userId,
        role: invitation.role,
        invitationId: invitation.id,
        joinedAt: new Date(),
      })
      .returning();

    // Update invitation status
    await db
      .update(teamInvitations)
      .set({
        status: "accepted",
        acceptedAt: new Date(),
      })
      .where(eq(teamInvitations.id, invitation.id));

    // Generate auth token for the user
    const { signToken } = await import("@/lib/auth");
    const authToken = signToken({ userId, email: invitation.email });

    return NextResponse.json({
      message: "Successfully joined the team",
      token: authToken,
      user: {
        id: userId,
        email: invitation.email,
        name: invitation.name,
        role: teamMember.role,
        businessId: invitation.businessProfileId,
      },
    });
  } catch (err) {
    console.error("Accept invitation error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}