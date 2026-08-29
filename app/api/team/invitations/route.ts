import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teamInvitations, businessProfiles } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { eq } from "drizzle-orm";

// Get all invitations for the user's business
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    const invitations = await db
      .select()
      .from(teamInvitations)
      .where(eq(teamInvitations.businessProfileId, profile.id))
      .orderBy(teamInvitations.createdAt);

    return NextResponse.json(invitations);
  } catch (err) {
    console.error("Get invitations error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}