import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gt, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, events, ticketTypes } from "@/drizzle/schema";
import { ensureOperationalSchema } from "@/lib/ensure-schema";

/**
 * GET /api/catalog/events — public event listing across all operators.
 * Query: ?country=MW&q=food — only published, future events; each row gains
 * derived status (on-sale | selling-fast | sold-out) and fromPrice.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();

    const { searchParams } = new URL(req.url);
    const country = searchParams.get("country")?.trim().toUpperCase();
    const q = searchParams.get("q")?.trim();

    const conditions = [
      eq(events.status, "published"),
      gt(events.startsAt, new Date()),
    ];
    if (country) conditions.push(eq(events.countryCode, country));
    if (q) {
      conditions.push(
        or(
          ilike(events.title, `%${q}%`),
          ilike(events.venue, `%${q}%`),
          ilike(events.city, `%${q}%`)
        )!
      );
    }

    const rows = await db
      .select({
        id: events.id,
        title: events.title,
        subtitle: events.subtitle,
        category: events.category,
        organizer: events.organizer,
        location: events.location,
        venue: events.venue,
        city: events.city,
        countryCode: events.countryCode,
        startsAt: events.startsAt,
        image: events.image,
        operator: businessProfiles.businessName,
      })
      .from(events)
      .innerJoin(businessProfiles, eq(events.businessProfileId, businessProfiles.id))
      .where(and(...conditions))
      .orderBy(asc(events.startsAt));

    const ticketRows = await db
      .select()
      .from(ticketTypes)
      .where(gt(ticketTypes.remaining, 0));

    const byEvent = new Map<number, typeof ticketRows>();
    for (const ticket of ticketRows) {
      const list = byEvent.get(ticket.eventId) ?? [];
      list.push(ticket);
      byEvent.set(ticket.eventId, list);
    }

    const catalog = rows.map((event) => {
      const tickets = byEvent.get(event.id) ?? [];
      const capacity = tickets.reduce((sum, t) => sum + t.capacity, 0);
      const remaining = tickets.reduce((sum, t) => sum + t.remaining, 0);
      const status =
        capacity === 0 || remaining === 0
          ? "sold-out"
          : remaining / capacity <= 0.2
            ? "selling-fast"
            : "on-sale";
      return {
        ...event,
        fromPrice: tickets.length ? Math.min(...tickets.map((t) => t.price)) : null,
        currency: tickets[0]?.currency ?? "MWK",
        status,
      };
    });

    return NextResponse.json({ events: catalog });
  } catch (err) {
    console.error("Catalog events error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
