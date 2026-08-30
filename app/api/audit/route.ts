import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLogs, businessProfiles } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";

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

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.businessProfileId, businessProfileId))
      .orderBy(auditLogs.createdAt);

    return NextResponse.json(logs);
  } catch (error) {
    console.error("Audit log error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
