import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teamMembers, businessProfiles } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { eq, and } from "drizzle-orm";

interface Params {
  params: Promise<{ id: string }>;
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const memberId = parseInt(id, 10);

    if (isNaN(memberId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
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

    // Verify the member belongs to this business
    const [member] = await db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.id, memberId),
          eq(teamMembers.businessProfileId, profile.id)
        )
      )
      .limit(1);

    if (!member) {
      return NextResponse.json(
        { error: "Team member not found" },
        { status: 404 }
      );
    }

    await db
      .delete(teamMembers)
      .where(eq(teamMembers.id, memberId));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Remove member error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}