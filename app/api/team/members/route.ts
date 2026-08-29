import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teamMembers, users, businessProfiles } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { eq } from "drizzle-orm";

// Get all team members for the user's business
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

    const members = await db
      .select({
        id: teamMembers.id,
        userId: teamMembers.userId,
        role: teamMembers.role,
        joinedAt: teamMembers.joinedAt,
        email: users.email,
        name: users.name,
        avatar: users.avatar,
      })
      .from(teamMembers)
      .innerJoin(users, eq(users.id, teamMembers.userId))
      .where(eq(teamMembers.businessProfileId, profile.id));

    // Add the business owner to the list
    const [owner] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatar: users.avatar,
      })
      .from(users)
      .where(eq(users.id, profile.userId))
      .limit(1);

    const ownerMember = {
      id: -1, // Special ID for owner
      userId: owner.id,
      role: "owner" as const,
      joinedAt: profile.createdAt,
      email: owner.email,
      name: owner.name,
      avatar: owner.avatar,
      isOwner: true,
    };

    return NextResponse.json([ownerMember, ...members]);
  } catch (err) {
    console.error("Get members error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}