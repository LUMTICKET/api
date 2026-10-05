import { NextRequest, NextResponse } from "next/server";
import { getUserById, validateSessionToken } from "@/lib/auth";
import { ensureAuthSchema } from "@/lib/ensure-auth-schema";
import { buildAuthUser } from "@/lib/identity";

/**
 * GET /api/auth/me
 *
 * Returns the authenticated account: login identifiers (email, phone,
 * Business ID), the business linkage (`isInBusiness` + which business) and
 * the role/permissions the account signs in with.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureAuthSchema();

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decoded = await validateSessionToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getUserById(decoded.userId);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(await buildAuthUser(user));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
