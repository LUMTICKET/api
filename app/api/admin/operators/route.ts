import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, businessTypes, users } from "@/drizzle/schema";
import { createPlatformAudit, getPlatformUser } from "@/lib/admin";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { parseId } from "@/lib/ownership";

const statuses = ["active", "suspended"] as const;

/**
 * Operators & agents directory (staff OperatorsPanel).
 * GET /api/admin/operators — all business profiles with their type,
 *   country, commission rate, verification, and account status.
 * PATCH /api/admin/operators?id=<profileId> — {accountStatus} toggles
 *   active/suspended and writes a platform audit entry.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rows = await db
      .select({
        id: businessProfiles.id,
        businessName: businessProfiles.businessName,
        email: businessProfiles.email,
        type: businessTypes.name,
        ownerName: users.name,
        country: businessProfiles.country,
        commissionRate: businessProfiles.commissionRate,
        isVerified: businessProfiles.isVerified,
        accountStatus: businessProfiles.accountStatus,
        createdAt: businessProfiles.createdAt,
      })
      .from(businessProfiles)
      .innerJoin(users, eq(businessProfiles.userId, users.id))
      .leftJoin(businessTypes, eq(users.businessTypeId, businessTypes.id))
      .orderBy(desc(businessProfiles.createdAt));

    return NextResponse.json({ operators: rows });
  } catch (err) {
    console.error("List operators error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = parseId(new URL(req.url).searchParams.get("id") ?? "");
    if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

    const body = await req.json();
    const accountStatus = body.accountStatus;
    if (!statuses.includes(accountStatus)) {
      return NextResponse.json({ error: "accountStatus must be active or suspended" }, { status: 400 });
    }

    const [profile] = await db.select().from(businessProfiles).where(eq(businessProfiles.id, id)).limit(1);
    if (!profile) return NextResponse.json({ error: "Operator not found" }, { status: 404 });

    const [updated] = await db
      .update(businessProfiles)
      .set({ accountStatus, updatedAt: new Date() })
      .where(eq(businessProfiles.id, id))
      .returning();

    await createPlatformAudit(
      user.email ?? `user-${user.id}`,
      accountStatus === "suspended" ? "Suspended account" : "Reactivated account",
      `business-profile/${id}`
    );

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Update operator status error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
