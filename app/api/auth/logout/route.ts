import { NextRequest, NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { revokeSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await validateSessionToken(token);
    if (!decoded || !decoded.sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await revokeSession(decoded.sessionId);

    return NextResponse.json({ success: true, message: "Logged out" });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
