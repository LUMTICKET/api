import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { busRoutes, businessProfiles, schedules } from "@/drizzle/schema";
import { ensureOperationalSchema } from "@/lib/ensure-schema";

/**
 * GET /api/catalog/schedules?routeId=12 — public. Upcoming departures of a published bus route,
 * with the seats still free. The fare is the route's price per seat.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const routeId = Number(new URL(req.url).searchParams.get("routeId"));
    if (!Number.isInteger(routeId) || routeId <= 0) {
      return NextResponse.json({ error: "routeId is required" }, { status: 400 });
    }

    const rows = await db
      .select({
        id: schedules.id,
        departureAt: schedules.departureAt,
        seatsTotal: schedules.seatsTotal,
        seatsSold: schedules.seatsSold,
        status: schedules.status,
        origin: busRoutes.origin,
        destination: busRoutes.destination,
        duration: busRoutes.duration,
        price: busRoutes.fromPrice,
        currency: busRoutes.currency,
        operator: businessProfiles.businessName,
      })
      .from(schedules)
      .innerJoin(busRoutes, eq(schedules.routeId, busRoutes.id))
      .innerJoin(businessProfiles, eq(busRoutes.businessProfileId, businessProfiles.id))
      .where(
        and(
          eq(schedules.routeId, routeId),
          eq(busRoutes.isPublished, true),
          inArray(schedules.status, ["scheduled"]),
          gt(schedules.departureAt, new Date()),
          gt(schedules.seatsTotal, 0),
        ),
      )
      .orderBy(asc(schedules.departureAt))
      .limit(30);

    return NextResponse.json({
      schedules: rows.map((r) => ({
        ...r,
        seatsLeft: Math.max(0, r.seatsTotal - r.seatsSold),
      })),
    });
  } catch (err) {
    console.error("Catalog schedules error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
