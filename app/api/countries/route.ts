import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { countries } from "@/drizzle/schema";
import { ensureOperationalSchema } from "@/lib/ensure-schema";

/**
 * GET /api/countries — public list of supported countries with currency,
 * flag key, and whether the platform is live there.
 */
export async function GET() {
  try {
    await ensureOperationalSchema();
    const rows = await db.select().from(countries).orderBy(asc(countries.name));
    return NextResponse.json({ countries: rows });
  } catch (err) {
    console.error("List countries error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
