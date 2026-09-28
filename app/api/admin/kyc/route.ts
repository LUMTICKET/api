import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, kycReviews } from "@/drizzle/schema";
import { createPlatformAudit, getPlatformUser } from "@/lib/admin";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { parseId } from "@/lib/ownership";

const statuses = ["pending", "approved", "rejected", "re-verification"] as const;
const riskTiers = ["low", "medium", "high"] as const;

/**
 * Platform KYC reviews (staff KycReviewPanel).
 * GET /api/admin/kyc — review queue joined with business profiles.
 * POST /api/admin/kyc — decide: {id, status, riskTier?}. Sets reviewer_id and
 *   decided_at; on approve also flips business_profiles.is_verified to true.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rows = await db
      .select({
        id: kycReviews.id,
        businessProfileId: kycReviews.businessProfileId,
        businessName: businessProfiles.businessName,
        country: businessProfiles.country,
        email: businessProfiles.email,
        riskTier: kycReviews.riskTier,
        status: kycReviews.status,
        submittedAt: kycReviews.submittedAt,
        reviewerId: kycReviews.reviewerId,
        decidedAt: kycReviews.decidedAt,
      })
      .from(kycReviews)
      .innerJoin(businessProfiles, eq(kycReviews.businessProfileId, businessProfiles.id))
      .orderBy(desc(kycReviews.submittedAt));

    return NextResponse.json({ kycQueue: rows });
  } catch (err) {
    console.error("List KYC queue error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const id = parseId(String(body.id ?? ""));
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const status = body.status;
    if (!statuses.includes(status)) {
      return NextResponse.json({ error: "status must be pending, approved, rejected, or re-verification" }, { status: 400 });
    }

    const [review] = await db.select().from(kycReviews).where(eq(kycReviews.id, id)).limit(1);
    if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

    const [updated] = await db
      .update(kycReviews)
      .set({
        status,
        riskTier: body.riskTier !== undefined && riskTiers.includes(body.riskTier) ? body.riskTier : review.riskTier,
        reviewerId: user.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(kycReviews.id, id))
      .returning();

    if (status === "approved") {
      await db
        .update(businessProfiles)
        .set({ isVerified: true })
        .where(eq(businessProfiles.id, review.businessProfileId));
    }

    await createPlatformAudit(
      user.email ?? `user-${user.id}`,
      `${status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Reopened"} KYC`,
      `business-profile/${review.businessProfileId}`
    );

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Decide KYC error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
