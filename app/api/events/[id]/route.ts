import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, events, teamMembers, ticketTypes } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { createAuditLog } from "@/lib/audit";

const categories = ["event", "bus", "flight", "tourism"] as const;
interface TicketInput { name?: string; price?: number; currency?: string; perks?: string[]; capacity?: number; remaining?: number; }
interface Params { params: Promise<{ id: string }> }

async function getEventAdmin(eventId: number, userId: number) {
  const [record] = await db.select({ event: events, profileUserId: businessProfiles.userId })
    .from(events)
    .innerJoin(businessProfiles, eq(events.businessProfileId, businessProfiles.id))
    .where(eq(events.id, eventId)).limit(1);
  if (!record) return null;
  if (record.profileUserId === userId) return record;

  const [membership] = await db.select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(
      eq(teamMembers.businessProfileId, record.event.businessProfileId),
      eq(teamMembers.userId, userId),
      eq(teamMembers.role, "admin")
    )).limit(1);
  return membership ? record : null;
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const eventId = Number((await params).id);
    if (!Number.isInteger(eventId)) return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
    const access = await getEventAdmin(eventId, user.id);
    if (!access) return NextResponse.json({ error: "Event not found or admin access required" }, { status: 404 });

    const body = await req.json();
    const category = body.category ?? access.event.category;
    if (!categories.includes(category)) return NextResponse.json({ error: "category must be event, bus, flight, or tourism" }, { status: 400 });

    const startsAt = body.startsAt || body.date ? new Date(body.startsAt ?? body.date) : access.event.startsAt;
    if (Number.isNaN(startsAt.getTime())) return NextResponse.json({ error: "Invalid startsAt" }, { status: 400 });

    const hasTickets = Array.isArray(body.tickets) || Array.isArray(body.tiers);
    const inputTickets: TicketInput[] = body.tickets ?? body.tiers ?? [];
    const normalizedTickets = hasTickets ? inputTickets.map((ticket) => {
      const capacity = Number(ticket.capacity ?? ticket.remaining);
      const price = Number(ticket.price);
      if (!ticket.name || !Number.isInteger(capacity) || capacity <= 0 || !Number.isInteger(price) || price < 0) {
        throw new Error("Each ticket requires a name, non-negative integer price, and positive integer capacity");
      }
      return { name: String(ticket.name).trim(), price, currency: String(ticket.currency ?? "MWK").toUpperCase(), perks: Array.isArray(ticket.perks) ? ticket.perks.map(String) : [], capacity, remaining: capacity };
    }) : [];
    if (hasTickets && !normalizedTickets.length) return NextResponse.json({ error: "At least one ticket type is required" }, { status: 400 });

    const updated = await db.transaction(async (transaction) => {
      const [event] = await transaction.update(events).set({
        title: body.title ?? access.event.title,
        subtitle: body.subtitle ?? access.event.subtitle,
        category,
        organizer: body.organizer ?? access.event.organizer,
        description: body.description ?? access.event.description,
        location: body.location ?? access.event.location,
        startsAt,
        endsAt: body.endsAt === null ? null : body.endsAt ? new Date(body.endsAt) : access.event.endsAt,
        image: body.image ?? access.event.image,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : access.event.tags,
        maxPerUser: body.maxPerUser === undefined ? access.event.maxPerUser : Number(body.maxPerUser),
        status: body.status ?? access.event.status,
        updatedAt: new Date(),
      }).where(eq(events.id, eventId)).returning();

      let tickets = await transaction.select().from(ticketTypes).where(eq(ticketTypes.eventId, eventId));
      if (hasTickets) {
        await transaction.delete(ticketTypes).where(eq(ticketTypes.eventId, eventId));
        tickets = await transaction.insert(ticketTypes).values(normalizedTickets.map((ticket) => ({ ...ticket, eventId }))).returning();
      }
      return { ...event, tickets };
    });

    await createAuditLog({ actorUserId: user.id, businessProfileId: access.event.businessProfileId, action: "updated", resourceType: "event", resourceId: eventId, details: { category: updated.category, ticketTypesUpdated: hasTickets } });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Each ticket")) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Update event error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const eventId = Number((await params).id);
    const access = await getEventAdmin(eventId, user.id);
    if (!access) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    const tickets = await db.select().from(ticketTypes).where(eq(ticketTypes.eventId, eventId));
    return NextResponse.json({ ...access.event, tickets });
  } catch (error) {
    console.error("Get event error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
