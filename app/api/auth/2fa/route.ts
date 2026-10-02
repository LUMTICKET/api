import { NextRequest, NextResponse } from "next/server";
import { getUserById, startSessionForUser } from "@/lib/auth";
import { ensureAuthSchema } from "@/lib/ensure-auth-schema";
import { buildAuthUser } from "@/lib/identity";
import { verifyTwoFactorChallenge } from "@/lib/two-factor";

/**
 * POST /api/auth/2fa
 *
 * Second step of a password login: verifies the 6-digit code sent to the
 * account email against the `challengeToken` returned by POST /api/auth/login
 * and, on success, returns the session tokens plus the user identity (role,
 * business linkage) exactly like a direct login would.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureAuthSchema();

    const { challengeToken, code } = await req.json();
    if (!challengeToken || !code) {
      return NextResponse.json(
        { error: "challengeToken and code are required" },
        { status: 400 }
      );
    }

    const result = await verifyTwoFactorChallenge(challengeToken, code);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const user = await getUserById(result.userId);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const session = await startSessionForUser(user, req);
    const authUser = await buildAuthUser(user);
    return NextResponse.json({
      ...session,
      user: authUser,
      nextStep: authUser.isInBusiness ? "dashboard" : "register-business",
    });
  } catch (err) {
    console.error("Two-factor verify error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
