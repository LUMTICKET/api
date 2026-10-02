import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, kycReviews, users } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { isValidEmail, isValidPhone, normalizeEmail, normalizePhone } from "@/lib/auth";
import { ensureAuthSchema } from "@/lib/ensure-auth-schema";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { buildAuthUser } from "@/lib/identity";
import { resolveBusinessType, serializeBusinessType } from "@/lib/business-types";
import { createAuditLog } from "@/lib/audit";

/** KYB details the dashboard still needs after the minimal registration. */
const COMPLETION_FIELDS = ["phone", "address", "city", "country"] as const;

function missingProfileFields(profile: {
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
}) {
  const missing: string[] = [];
  if (!profile.email) missing.push("email");
  for (const field of COMPLETION_FIELDS) {
    if (!profile[field]) missing.push(field);
  }
  return missing;
}

/**
 * POST /api/business/register
 *
 * The business registration that happens *after* the login credentials are
 * created (signup or Google). Deliberately minimal — business type and
 * business name only — so the user is not discouraged by a long form during
 * account creation. Everything else (address, documents, executives, …) is
 * completed from the dashboard with PUT /api/kyb/:id.
 *
 * On success the account becomes `isInBusiness: true` and is linked to the
 * created business (`businessProfileId`).
 */
export async function POST(req: NextRequest) {
  try {
    await ensureAuthSchema();
    // The kyc_reviews row created below needs the operational schema.
    await ensureOperationalSchema();

    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const businessName = String(body.businessName ?? "").trim();

    if (!businessName) {
      return NextResponse.json(
        { error: "businessName is required" },
        { status: 400 }
      );
    }

    if (
      body.businessType === undefined ||
      body.businessType === null ||
      body.businessType === ""
    ) {
      return NextResponse.json(
        { error: "businessType is required (id, slug, or name)" },
        { status: 400 }
      );
    }

    const resolvedBusinessType = await resolveBusinessType(body.businessType);
    if (!resolvedBusinessType) {
      return NextResponse.json(
        { error: "Invalid businessType. See GET /api/business-types" },
        { status: 400 }
      );
    }

    if (body.type !== undefined && body.type !== null && body.type !== "") {
      if (body.type !== "individual" && body.type !== "company") {
        return NextResponse.json(
          { error: "type must be 'individual' or 'company'" },
          { status: 400 }
        );
      }
    }

    if (body.email !== undefined && body.email !== null && body.email !== "" && !isValidEmail(body.email)) {
      return NextResponse.json(
        { error: "Enter a valid email address" },
        { status: 400 }
      );
    }
    if (body.phone !== undefined && body.phone !== null && body.phone !== "" && !isValidPhone(body.phone)) {
      return NextResponse.json(
        { error: "Enter a valid phone number" },
        { status: 400 }
      );
    }

    const existing = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.userId, user.id))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        {
          error: "Business profile already exists",
          businessProfileId: existing[0].id,
          nextStep: "dashboard",
        },
        { status: 409 }
      );
    }

    const [profile] = await db
      .insert(businessProfiles)
      .values({
        userId: user.id,
        businessTypeId: resolvedBusinessType.id,
        type: body.type ?? "individual",
        businessName,
        // Minimal first form: contact details fall back to the owner's own
        // account details and can be completed later from the dashboard.
        email: body.email ? normalizeEmail(body.email) : user.email,
        phone: body.phone
          ? normalizePhone(body.phone)
          : (user.phone ?? null),
        country: body.country ?? user.country ?? null,
        address: body.address ?? null,
        city: body.city ?? null,
        website: body.website ?? null,
        description: body.description ?? null,
        isVerified: false,
        executives: [],
        documents: [],
      })
      .returning();

    const [kycReview] = await db
      .insert(kycReviews)
      .values({ businessProfileId: profile.id, status: "pending", riskTier: "low" })
      .returning();

    const [updatedUser] = await db
      .update(users)
      .set({
        isInBusiness: true,
        businessProfileId: profile.id,
        businessTypeId: resolvedBusinessType.id,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    await createAuditLog({
      actorUserId: user.id,
      businessProfileId: profile.id,
      action: "registered",
      resourceType: "business_profile",
      resourceId: profile.id,
      details: {
        businessName,
        businessType: resolvedBusinessType.slug,
      },
    });

    const authUser = await buildAuthUser(updatedUser ?? user);
    const missingFields = missingProfileFields(profile);

    return NextResponse.json(
      {
        ...profile,
        businessType: serializeBusinessType(resolvedBusinessType),
        kycReview,
        missingFields,
        nextStep: missingFields.length > 0 ? "complete-profile" : "dashboard",
        user: authUser,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("Business registration error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * GET /api/business/register
 *
 * Reports the caller's business-registration status so the dashboard can
 * route the account: `register-business` (no business yet), `complete-profile`
 * (minimal business created, KYB details outstanding) or `dashboard`.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureAuthSchema();

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
      return NextResponse.json({
        registered: false,
        nextStep: "register-business",
        user: await buildAuthUser(user),
      });
    }

    const missingFields = missingProfileFields(profile);
    return NextResponse.json({
      registered: true,
      businessProfileId: profile.id,
      profile,
      missingFields,
      nextStep: missingFields.length > 0 ? "complete-profile" : "dashboard",
      user: await buildAuthUser(user),
    });
  } catch (err) {
    console.error("Business registration status error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
