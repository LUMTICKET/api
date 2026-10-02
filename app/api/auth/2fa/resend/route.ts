import { NextRequest, NextResponse } from "next/server";
import { ensureAuthSchema } from "@/lib/ensure-auth-schema";
import { resendTwoFactorChallenge } from "@/lib/two-factor";

/**
 * POST /api/auth/2fa/resend
 *
 * Emails a fresh 6-digit code for an existing, still-valid challenge token
 * (the token itself does not change, so the client can keep it).
 */
export async function POST(req: NextRequest) {
  try {
    await ensureAuthSchema();

    const { challengeToken } = await req.json();
    if (!challengeToken) {
      return NextResponse.json(
        { error: "challengeToken is required" },
        { status: 400 }
      );
    }

    const challenge = await resendTwoFactorChallenge(challengeToken);
    if (!challenge) {
      return NextResponse.json(
        { error: "Challenge not found or expired, start login again" },
        { status: 401 }
      );
    }

    return NextResponse.json({ requires2FA: true, ...challenge });
  } catch (err) {
    console.error("Two-factor resend error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
