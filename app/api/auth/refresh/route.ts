import { NextRequest, NextResponse } from "next/server";
import { rotateSession, getSession } from "@/lib/session";
import { signToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { refreshToken } = await req.json();

    if (!refreshToken) {
      return NextResponse.json({ error: "Refresh token required" }, { status: 400 });
    }

    const rotated = await rotateSession(refreshToken);
    if (!rotated) {
      return NextResponse.json({ error: "Invalid or expired refresh token" }, { status: 401 });
    }

    const session = await getSession(rotated.sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session expired" }, { status: 401 });
    }

    const accessToken = signToken({
      userId: session.userId,
      email: session.email,
      sessionId: session.sessionId,
    });

    return NextResponse.json({
      token: accessToken,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt.toISOString(),
      refreshToken: rotated.refreshToken,
      refreshExpiresAt: rotated.refreshExpiresAt,
    });
  } catch (error) {
    console.error("Refresh error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
