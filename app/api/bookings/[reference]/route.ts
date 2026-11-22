import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookings } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";

/**
 * GET /api/bookings/:reference — one booking of the authenticated user by
 * reference (e.g. LMT-BUS-8F3K2M).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { reference } = await params;
    const [row] = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.reference, reference), eq(bookings.userId, user.id)))
      .limit(1);

    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    console.error("Get booking error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
