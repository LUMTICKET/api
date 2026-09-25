import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { signToken, getUserByEmail } from "@/lib/auth";
import { createSession } from "@/lib/session";
import {
  getBusinessTypeForUser,
  resolveBusinessType,
  serializeBusinessType,
} from "@/lib/business-types";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const { idToken, email, name, avatar, businessType } = await req.json();

    if (!idToken || !email) {
      return NextResponse.json(
        { error: "Missing Google token" },
        { status: 400 }
      );
    }

    // Verify the Google ID token on your server if you want extra safety
    // (omitted for brevity — use google-auth-library)

    let user = await getUserByEmail(email);
    let businessTypePayload: ReturnType<typeof serializeBusinessType> = null;

    if (!user) {
      // Creating a brand-new Google account: the first sign-in must include
      // the business type the user operates.
      if (businessType === undefined || businessType === null || businessType === "") {
        return NextResponse.json(
          { error: "businessType is required on first sign-in (id, slug, or name)" },
          { status: 400 }
        );
      }

      const resolvedBusinessType = await resolveBusinessType(businessType);
      if (!resolvedBusinessType) {
        return NextResponse.json(
          { error: "Invalid businessType. See GET /api/business-types" },
          { status: 400 }
        );
      }

      // Create new Google user
      const [newUser] = await db
        .insert(users)
        .values({
          email,
          name: name || null,
          avatar: avatar || null,
          googleId: idToken.slice(-20), // or extract real sub from verified token
          businessTypeId: resolvedBusinessType.id,
        })
        .returning();
      user = newUser;
      businessTypePayload = serializeBusinessType(resolvedBusinessType);
    } else {
      // Existing account: business type already known (or updated via
      // PATCH /api/auth/signup), so it is optional here.
      if (businessType !== undefined && businessType !== null && businessType !== "") {
        const resolvedBusinessType = await resolveBusinessType(businessType);
        if (!resolvedBusinessType) {
          return NextResponse.json(
            { error: "Invalid businessType. See GET /api/business-types" },
            { status: 400 }
          );
        }
        const [updated] = await db
          .update(users)
          .set({ businessTypeId: resolvedBusinessType.id, updatedAt: new Date() })
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

    const linkedBusinessType =
      businessTypePayload ??
      serializeBusinessType(await getBusinessTypeForUser(user.id));

    const session = await createSession(user.id, user.email, {
      userAgent: req.headers.get("user-agent"),
      ipAddress: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
    });
    const token = signToken({
      userId: user.id,
      email: user.email,
      sessionId: session.sessionId,
    });

    return NextResponse.json({
      token,
      refreshToken: session.refreshToken,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      refreshExpiresAt: session.refreshExpiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        businessType: linkedBusinessType,
      },
    });
  } catch (err) {
    console.error("Google auth error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
