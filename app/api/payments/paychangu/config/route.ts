import { NextRequest, NextResponse } from "next/server";
import { getPlatformUser } from "@/lib/admin";
import { paychanguDiagnostics } from "@/lib/paychangu";

/**
 * GET /api/payments/paychangu/config  (platform staff only)
 *
 * Setup check for the PayChangu integration. Reports which settings are present (never their
 * values), whether the key is a test or live key, whether PayChangu's direct mobile money charge is
 * available (own PIN-prompt screen) or everything goes through the hosted page, and the exact
 * webhook URL to register in the PayChangu dashboard.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const origin = (process.env.PUBLIC_API_URL ?? new URL(req.url).origin).replace(/\/$/, "");
    return NextResponse.json({
      ...(await paychanguDiagnostics()),
      webhookUrl: `${origin}/api/payments/paychangu/webhook`,
    });
  } catch (error) {
    console.error("PayChangu config check error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
