import { NextRequest, NextResponse } from "next/server";
import {
  comparePassword,
  findUserByIdentifier,
  startSessionForUser,
} from "@/lib/auth";
import { ensureAuthSchema } from "@/lib/ensure-auth-schema";
import { buildAuthUser } from "@/lib/identity";
import { createTwoFactorChallenge } from "@/lib/two-factor";

/**
 * POST /api/auth/login
 *
 * Accepts a single `identifier` — a Business ID (LMT-…), an email address or
 * a phone number — plus the password. `email` / `phone` / `businessId` keys
 * are still accepted as aliases of `identifier`.
 *
 * When two-factor authentication is enabled for the account (the default),
 * the response does not contain a session: it returns `requires2FA` with a
 * `challengeToken` and the code emailed to the account. The client then calls
 * POST /api/auth/2fa with the code to receive the session tokens.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureAuthSchema();

    const body = await req.json();
    const identifier =
      body.identifier ?? body.email ?? body.phone ?? body.businessId;
    const password = body.password;

    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Business ID, email or phone and password required" },
        { status: 400 }
      );
    }

    const user = await findUserByIdentifier(String(identifier));
    if (!user || !user.password) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const valid = await comparePassword(password, user.password);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    if (user.twoFactorEnabled) {
      const challenge = await createTwoFactorChallenge(user);
      if (challenge.delivery === "failed" && process.env.NODE_ENV === "production") {
        // Fail closed: without the emailed code the login cannot be completed.
        return NextResponse.json(
          { error: "Could not send the verification email. Please try again later." },
          { status: 502 }
        );
      }
      return NextResponse.json({
        requires2FA: true,
        userId: user.id,
        ...challenge,
      });
    }

    const session = await startSessionForUser(user, req);
    const authUser = await buildAuthUser(user);
    return NextResponse.json({
      ...session,
      user: authUser,
      nextStep: authUser.isInBusiness ? "dashboard" : "register-business",
    });
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
