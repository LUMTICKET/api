import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { hashPassword, signToken } from "@/lib/auth";
import { createSession } from "@/lib/session";
import { getCurrentUser } from "@/lib/auth-kyb";
import {
  getBusinessTypeForUser,
  resolveBusinessType,
  serializeBusinessType,
  setBusinessTypeForUser,
} from "@/lib/business-types";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const { email, password, name, country, businessType } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
    }

    if (businessType === undefined || businessType === null || businessType === "") {
      return NextResponse.json(
        { error: "businessType is required (id, slug, or name)" },
        { status: 400 }
      );
    }

    // Check existing
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    const resolvedBusinessType = await resolveBusinessType(businessType);
    if (!resolvedBusinessType) {
      return NextResponse.json(
        { error: "Invalid businessType. See GET /api/business-types" },
        { status: 400 }
      );
    }

    const hashed = await hashPassword(password);

    const [user] = await db
      .insert(users)
      .values({
        email,
        password: hashed,
        name: name || null,
        country: country || null,
        businessTypeId: resolvedBusinessType.id,
      })
      .returning();

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
        businessType: serializeBusinessType(resolvedBusinessType),
      },
    });
  } catch (err) {
    console.error("Signup error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  // Reserved for updating the business type after signup; requires auth.
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const resolved = await resolveBusinessType(body.businessType);
    if (!resolved) {
      return NextResponse.json(
        { error: "Invalid businessType. See GET /api/business-types" },
        { status: 400 }
      );
    }

    const updated = await setBusinessTypeForUser(user.id, resolved.id);
    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const businessType = await getBusinessTypeForUser(user.id);
    return NextResponse.json({
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        avatar: updated.avatar,
        businessType: serializeBusinessType(businessType),
      },
    });
  } catch (err) {
    console.error("Update business type error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
