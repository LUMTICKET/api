import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, teamRoles } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { createAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, description, permissions, businessProfileId } = await req.json();

    if (!name || !businessProfileId) {
      return NextResponse.json(
        { error: "Role name and businessProfileId are required" },
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

    const [role] = await db
      .insert(teamRoles)
      .values({
        businessProfileId,
        name: String(name).trim(),
        description: description ?? null,
        permissions: Array.isArray(permissions) ? permissions.map(String) : [],
        createdBy: user.id,
      })
      .returning();

    await createAuditLog({
      actorUserId: user.id,
      businessProfileId,
      teamRoleId: role.id,
      action: "created",
      resourceType: "team_role",
      resourceId: role.id,
      details: { name: role.name, permissions: role.permissions },
    });

    return NextResponse.json(role, { status: 201 });
  } catch (error) {
    console.error("Create team role error:", error);
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

    const roles = await db
      .select()
      .from(teamRoles)
      .where(eq(teamRoles.businessProfileId, businessProfileId));

    return NextResponse.json(roles);
  } catch (error) {
    console.error("Get team roles error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
