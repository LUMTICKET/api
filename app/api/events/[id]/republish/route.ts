import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookings, businessProfiles, events, payments, ticketTypes } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { createAuditLog } from "@/lib/audit";
import { publishingFeeMwk, eventTierFor } from "@/lib/fees";
import { readAnyIntent } from "@/lib/purchase";
import { publicPosterUrl, validatePoster } from "@/lib/poster";

interface Params { params: Promise<{ id: string }> }
interface TicketInput { id?: number; name: string; price: number; currency?: string; perks?: string[]; capacity: number; }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const eventId = Number((await params).id);
    if (!Number.isInteger(eventId)) return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
    const [owned] = await db.select({ event: events, ownerId: businessProfiles.userId })
      .from(events).innerJoin(businessProfiles, eq(events.businessProfileId, businessProfiles.id))
      .where(eq(events.id, eventId)).limit(1);
    if (!owned || owned.ownerId !== user.id) return NextResponse.json({ error: "Event not found or owner access required" }, { status: 404 });

    const body = await req.json();
    const paymentId = Number(body.paymentId);
    if (!paymentId) return NextResponse.json({ error: "A successful publishing-fee payment is required" }, { status: 400 });
    const [payment] = await db.select().from(payments).where(and(
      eq(payments.id, paymentId), eq(payments.businessProfileId, owned.event.businessProfileId), eq(payments.userId, user.id)
    )).limit(1);
    if (!payment || payment.status !== "succeeded") return NextResponse.json({ error: "Publishing-fee payment is not successful" }, { status: 402 });
    const meta = (payment.metadata ?? {}) as Record<string, unknown>;
    if (readAnyIntent(meta) || meta.paymentType !== "publishing-fee" || meta.reversed) return NextResponse.json({ error: "This is not an unused publishing-fee payment" }, { status: 400 });
    if (payment.currency !== "MWK" || payment.amount < publishingFeeMwk()) return NextResponse.json({ error: `Publishing fee must be MWK ${publishingFeeMwk()}` }, { status: 402 });
    const alreadyUsed = await db.select({ id: events.id }).from(events).where(eq(events.paymentId, paymentId)).limit(1);
    if (alreadyUsed.length) return NextResponse.json({ error: "This publishing payment has already been used" }, { status: 409 });

    const startsAt = body.startsAt ? new Date(body.startsAt) : owned.event.startsAt;
    if (Number.isNaN(startsAt.getTime())) return NextResponse.json({ error: "Invalid event date" }, { status: 400 });
    if (body.title !== undefined && !String(body.title).trim()) return NextResponse.json({ error: "Event title cannot be empty" }, { status: 400 });
    if (body.location !== undefined && !String(body.location).trim()) return NextResponse.json({ error: "Event location cannot be empty" }, { status: 400 });
    if (body.endsAt) {
      const end = new Date(body.endsAt);
      if (Number.isNaN(end.getTime()) || end < startsAt) return NextResponse.json({ error: "Event end date must be valid and cannot be before the start date" }, { status: 400 });
    }
    const allowedCategories = ["event", "bus", "flight", "tourism"];
    if (body.category !== undefined && !allowedCategories.includes(body.category)) return NextResponse.json({ error: "Invalid event category" }, { status: 400 });
    const tickets: TicketInput[] | undefined = Array.isArray(body.tickets) ? body.tickets : undefined;
    if (tickets && tickets.length === 0) return NextResponse.json({ error: "At least one ticket type is required" }, { status: 400 });
    if (tickets?.some((ticket) => !ticket.name?.trim() || !Number.isInteger(Number(ticket.capacity)) || Number(ticket.capacity) <= 0 || !Number.isInteger(Number(ticket.price)) || Number(ticket.price) < 0 || (ticket.id !== undefined && !Number.isInteger(Number(ticket.id))))) {
      return NextResponse.json({ error: "Each ticket requires a name, non-negative integer price and positive integer capacity" }, { status: 400 });
    }
    const existing = await db.select().from(ticketTypes).where(eq(ticketTypes.eventId, eventId));
    const existingIds = new Set(existing.map((t) => t.id));
    const requestedIds = new Set((tickets ?? []).filter((t) => Number.isInteger(Number(t.id))).map((t) => Number(t.id)));
    if (tickets && [...requestedIds].some((id) => !existingIds.has(id))) return NextResponse.json({ error: "A ticket type does not belong to this event" }, { status: 400 });

    const posterInput = body.image === undefined ? undefined : validatePoster(body.image);
    if (posterInput && !posterInput.ok) return NextResponse.json({ error: posterInput.error }, { status: 400 });
    const totalCapacity = tickets ? tickets.reduce((sum, t) => sum + Number(t.capacity), 0) : existing.reduce((sum, t) => sum + t.capacity, 0);
    const maxPrice = tickets ? Math.max(...tickets.map((t) => Number(t.price))) : Math.max(0, ...existing.map((t) => t.price));
    const tier = eventTierFor({ totalCapacity, maxTicketPrice: maxPrice });

    const updated = await db.transaction(async (tx) => {
      if (tickets) {
        for (const input of tickets) {
          const capacity = Number(input.capacity), price = Number(input.price);
          if (!input.name?.trim() || !Number.isInteger(capacity) || capacity <= 0 || !Number.isInteger(price) || price < 0) throw new Error("Invalid ticket type: name, non-negative price and positive capacity are required");
          if (input.id) {
            const old = existing.find((t) => t.id === Number(input.id))!;
            const booked = await tx.select({ quantity: bookings.quantity }).from(bookings).where(eq(bookings.ticketTypeId, old.id));
            const sold = booked.reduce((sum, b) => sum + b.quantity, 0);
            if (capacity < sold) throw new Error(`Capacity for ${old.name} cannot be lower than ${sold} tickets already sold`);
            await tx.update(ticketTypes).set({ name: input.name.trim(), price, currency: String(input.currency ?? old.currency).toUpperCase(), perks: Array.isArray(input.perks) ? input.perks.map(String) : old.perks, capacity, remaining: capacity - sold, updatedAt: new Date() }).where(eq(ticketTypes.id, old.id));
          } else {
            await tx.insert(ticketTypes).values({ eventId, name: input.name.trim(), price, currency: String(input.currency ?? "MWK").toUpperCase(), perks: Array.isArray(input.perks) ? input.perks.map(String) : [], capacity, remaining: capacity });
          }
        }
        const removedIds = existing.filter((t) => !requestedIds.has(t.id)).map((t) => t.id);
        if (removedIds.length) {
          const soldRows = await tx.select({ id: bookings.id }).from(bookings).where(inArray(bookings.ticketTypeId, removedIds)).limit(1);
          if (soldRows.length) throw new Error("Ticket types with existing bookings cannot be removed. Keep them and set their remaining capacity to zero instead.");
          await tx.delete(ticketTypes).where(inArray(ticketTypes.id, removedIds));
        }
      }
      const [event] = await tx.update(events).set({
        paymentId,
        title: body.title === undefined ? owned.event.title : String(body.title).trim(),
        subtitle: body.subtitle === undefined ? owned.event.subtitle : body.subtitle,
        category: body.category ?? owned.event.category,
        organizer: body.organizer === undefined ? owned.event.organizer : body.organizer,
        description: body.description === undefined ? owned.event.description : body.description,
        location: body.location === undefined ? owned.event.location : String(body.location).trim(),
        venue: body.venue === undefined ? owned.event.venue : body.venue,
        city: body.city === undefined ? owned.event.city : body.city,
        countryCode: body.countryCode === undefined ? owned.event.countryCode : body.countryCode,
        startsAt,
        endsAt: body.endsAt === undefined ? owned.event.endsAt : body.endsAt ? new Date(body.endsAt) : null,
        image: posterInput ? posterInput.value : owned.event.image,
        tags: Array.isArray(body.tags) ? body.tags.map(String) : owned.event.tags,
        tier,
        status: "published",
        updatedAt: new Date(),
      }).where(eq(events.id, eventId)).returning();
      const ticketRows = await tx.select().from(ticketTypes).where(eq(ticketTypes.eventId, eventId));
      return { ...event, tickets: ticketRows };
    });
    await createAuditLog({ actorUserId: user.id, businessProfileId: owned.event.businessProfileId, action: "updated", resourceType: "event", resourceId: eventId, details: { republished: true, paymentId, tier } });
    return NextResponse.json({ ...updated, image: publicPosterUrl(updated.id, updated.image, updated.updatedAt) });
  } catch (error) {
    if (error instanceof Error && (/Invalid ticket type|Capacity for|Ticket types with/.test(error.message))) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Republish event error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
