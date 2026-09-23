import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, teamInvitations, teamRoles } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { createAuditLog } from "@/lib/audit";

// 1. PUBLIC GET: Fetches preview information using the token
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const [invitation] = await db
      .select({
        email: teamInvitations.email,
        name: teamInvitations.name,
        role: teamInvitations.role,
        businessName: businessProfiles.businessName,
        expiresAt: teamInvitations.expiresAt,
        status: teamInvitations.status,
      })
      .from(teamInvitations)
      .innerJoin(
        businessProfiles,
        eq(teamInvitations.businessProfileId, businessProfiles.id)
      )
      .where(eq(teamInvitations.token, token))
      .limit(1);

    if (!invitation) {
      return NextResponse.json(
        { error: "Invitation not found." },
        { status: 404 }
      );
    }

    if (invitation.status !== "pending" || new Date() > new Date(invitation.expiresAt)) {
      return NextResponse.json(
        { error: "This invitation is no longer active or has expired." },
        { status: 410 }
      );
    }

    return NextResponse.json(invitation);
  } catch (error) {
    console.error("Fetch invitation token error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// 2. AUTHENTICATED POST: Accepts the invitation
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { token } = await params;

    const [invitation] = await db
      .select()
      .from(teamInvitations)
      .where(
        and(
          eq(teamInvitations.token, token),
          eq(teamInvitations.status, "pending")
        )
      )
      .limit(1);

    if (!invitation) {
      return NextResponse.json(
        { error: "Invitation not found or already processed." },
        { status: 404 }
      );
    }

    // Update status to accepted
    await db
      .update(teamInvitations)
      .set({ status: "accepted" })
      .where(eq(teamInvitations.id, invitation.id));

    await createAuditLog({
      actorUserId: user.id,
      businessProfileId: invitation.businessProfileId,
      teamInvitationId: invitation.id,
      targetUserId: user.id,
      action: "accepted",
      resourceType: "team_invitation",
      resourceId: invitation.id,
      details: { email: invitation.email, role: invitation.role },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Accept invitation error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}