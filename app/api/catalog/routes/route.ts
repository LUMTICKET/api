import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { busRoutes, businessProfiles } from "@/drizzle/schema";
import { ensureOperationalSchema } from "@/lib/ensure-schema";

/**
 * GET /api/catalog/routes — public bus route search.
 * Query: ?origin=Lilongwe&destination=Blantyre&q=blantyre
 * Returns published routes with the operator display name.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();

    const { searchParams } = new URL(req.url);
    const origin = searchParams.get("origin")?.trim();
    const destination = searchParams.get("destination")?.trim();
    const q = searchParams.get("q")?.trim();

    const conditions = [eq(busRoutes.isPublished, true)];
    if (origin) conditions.push(ilike(busRoutes.origin, `%${origin}%`));
    if (destination) conditions.push(ilike(busRoutes.destination, `%${destination}%`));
    if (q) {
      conditions.push(
        or(ilike(busRoutes.origin, `%${q}%`), ilike(busRoutes.destination, `%${q}%`))!
      );
    }

    const rows = await db
      .select({
        id: busRoutes.id,
        operator: businessProfiles.businessName,
        origin: busRoutes.origin,
        destination: busRoutes.destination,
        duration: busRoutes.duration,
        fromPrice: busRoutes.fromPrice,
        currency: busRoutes.currency,
        departuresPerDay: busRoutes.departuresPerDay,
        rating: busRoutes.rating,
      })
      .from(busRoutes)
      .innerJoin(businessProfiles, eq(busRoutes.businessProfileId, businessProfiles.id))
      .where(and(...conditions))
      .orderBy(asc(busRoutes.fromPrice));

    return NextResponse.json({ routes: rows });
  } catch (err) {
    console.error("Catalog routes error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
