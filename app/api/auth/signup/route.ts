import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import {
  hashPassword,
  isStrongEnoughPassword,
  isValidEmail,
  isValidPhone,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  normalizePhone,
  startSessionForUser,
} from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureAuthSchema } from "@/lib/ensure-auth-schema";
import { allocateBusinessId, buildAuthUser } from "@/lib/identity";
import {
  resolveBusinessType,
  setBusinessTypeForUser,
} from "@/lib/business-types";
import { sql } from "drizzle-orm";

/**
 * POST /api/auth/signup
 *
 * Creates the login credentials only — name, a validated email, an optional
 * phone number and a password. The business itself is registered in a
 * separate step (POST /api/business/register) after credentials exist, so the
 * first form never blocks a user with business questions. The response's
 * `nextStep` tells the client where to go next (`register-business`).
 */
export async function POST(req: NextRequest) {
  try {
    await ensureAuthSchema();

    const { email, phone, password, name, country, businessType } =
      await req.json();

    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: "Enter a valid email address" },
        { status: 400 }
      );
    }
    if (phone !== undefined && phone !== null && phone !== "" && !isValidPhone(phone)) {
      return NextResponse.json(
        { error: "Enter a valid phone number" },
        { status: 400 }
      );
    }
    if (!isStrongEnoughPassword(password)) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone =
      phone !== undefined && phone !== null && phone !== ""
        ? normalizePhone(phone)
        : null;

    const [existingEmail] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalizedEmail}`)
      .limit(1);
    if (existingEmail) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    if (normalizedPhone) {
      const [existingPhone] = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.phone} = ${normalizedPhone}`)
        .limit(1);
      if (existingPhone) {
        return NextResponse.json(
          { error: "Phone already registered" },
          { status: 409 }
        );
      }
    }

    // Business type is optional here and only persisted for legacy clients;
    // registering the business happens afterwards via /api/business/register.
    let businessTypeId: number | null = null;
    if (businessType !== undefined && businessType !== null && businessType !== "") {
      const resolved = await resolveBusinessType(businessType);
      if (!resolved) {
        return NextResponse.json(
          { error: "Invalid businessType. See GET /api/business-types" },
          { status: 400 }
        );
      }
      businessTypeId = resolved.id;
    }

    const hashed = await hashPassword(password);
    const businessId = await allocateBusinessId();

    const [user] = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        phone: normalizedPhone,
        password: hashed,
        name: name || null,
        country: country || null,
        businessId,
        businessTypeId,
      })
      .returning();

    const session = await startSessionForUser(user, req);
    const authUser = await buildAuthUser(user);

    return NextResponse.json({
      ...session,
      user: authUser,
      nextStep: authUser.isInBusiness ? "dashboard" : "register-business",
    });
  } catch (err) {
    console.error("Signup error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/auth/signup
 * Reserved for updating the business type after signup; requires auth.
 */
export async function PATCH(req: NextRequest) {
  try {
    await ensureAuthSchema();

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

    return NextResponse.json({ user: await buildAuthUser(updated) });
  } catch (err) {
    console.error("Update business type error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
