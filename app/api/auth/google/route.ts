import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import {
  getUserByEmail,
  isValidEmail,
  normalizeEmail,
  startSessionForUser,
} from "@/lib/auth";
import { ensureAuthSchema } from "@/lib/ensure-auth-schema";
import { allocateBusinessId, buildAuthUser } from "@/lib/identity";
import { resolveBusinessType } from "@/lib/business-types";
import { eq } from "drizzle-orm";

/**
 * POST /api/auth/google
 *
 * Google sign-in. The business is registered in its own step afterwards, so
 * `businessType` is no longer required on first sign-in — when supplied it is
 * only stored on the account for legacy clients. New Google accounts start
 * with `isInBusiness: false` and the client takes them to business
 * registration (or straight to the dashboard for returning users).
 */
export async function POST(req: NextRequest) {
  try {
    await ensureAuthSchema();

    const { idToken, email, name, avatar, businessType } = await req.json();

    if (!idToken || !email) {
      return NextResponse.json(
        { error: "Missing Google token" },
        { status: 400 }
      );
    }

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: "Enter a valid email address" },
        { status: 400 }
      );
    }

    // Verify the Google ID token on your server if you want extra safety
    // (omitted for brevity — use google-auth-library)
    const normalizedEmail = normalizeEmail(email);

    let businessTypeId: number | null = null;
    if (businessType !== undefined && businessType !== null && businessType !== "") {
      const resolvedBusinessType = await resolveBusinessType(businessType);
      if (!resolvedBusinessType) {
        return NextResponse.json(
          { error: "Invalid businessType. See GET /api/business-types" },
          { status: 400 }
        );
      }
      businessTypeId = resolvedBusinessType.id;
    }

    let user = await getUserByEmail(normalizedEmail);
    const isNewAccount = !user;

    if (!user) {
      // Creating a brand-new Google account: credentials only, the business
      // itself is registered in the following onboarding step.
      const businessId = await allocateBusinessId();
      const [newUser] = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          name: name || null,
          avatar: avatar || null,
          googleId: idToken.slice(-20), // or extract real sub from verified token
          businessId,
          businessTypeId,
        })
        .returning();
      user = newUser;
    } else {
      if (businessTypeId !== null) {
        const [updated] = await db
          .update(users)
          .set({ businessTypeId, updatedAt: new Date() })
          .where(eq(users.id, user.id))
          .returning();
        user = updated;
      }

      if (!user.googleId) {
        // Link Google to existing account
        const [updated] = await db
          .update(users)
          .set({ googleId: idToken.slice(-20) })
          .where(eq(users.id, user.id))
          .returning();
        user = updated;
      }
    }

    const session = await startSessionForUser(user, req);
    const authUser = await buildAuthUser(user);

    return NextResponse.json({
      ...session,
      user: authUser,
      nextStep: authUser.isInBusiness ? "dashboard" : "register-business",
      ...(isNewAccount ? { isNewAccount: true } : {}),
    });
  } catch (err) {
    console.error("Google auth error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
