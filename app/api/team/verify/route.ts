import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teamInvitations, businessProfiles, users } from "@/drizzle/schema";
import { eq, and } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { error: "Token is required" },
        { status: 400 }
      );
    }

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

    // Get business and inviter info
    const [business] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.id, invitation.businessProfileId))
      .limit(1);

    const [inviter] = await db
      .select()
      .from(users)
      .where(eq(users.id, invitation.invitedBy))
      .limit(1);

    return NextResponse.json({
      id: invitation.id,
      email: invitation.email,
      name: invitation.name,
      role: invitation.role,
      businessName: business?.businessName || "Unknown Business",
      invitedByName: inviter?.name || "Unknown User",
      expiresAt: invitation.expiresAt,
    });
  } catch (err) {
    console.error("Verify invitation error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}