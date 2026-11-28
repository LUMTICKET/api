import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookings, businessProfiles, events, payments, teamMembers, ticketTypes } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { createAuditLog } from "@/lib/audit";
import { publishingFeeMwk, eventTierFor } from "@/lib/fees";
import { readAnyIntent } from "@/lib/purchase";
import { publicPosterUrl, validatePoster } from "@/lib/poster";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { PAYMENT_PROVIDER, settlePaychanguPayment } from "@/lib/paychangu";

interface Params { params: Promise<{ id: string }> }
interface TicketInput { id?: number; name: string; price: number; currency?: string; perks?: string[]; capacity: number; }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Please sign in again to republish this event." }, { status: 401 });
    const eventId = Number((await params).id);
    if (!Number.isInteger(eventId)) return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
    const [owned] = await db.select({ event: events, ownerId: businessProfiles.userId })
      .from(events).innerJoin(businessProfiles, eq(events.businessProfileId, businessProfiles.id))
      .where(eq(events.id, eventId)).limit(1);
    if (!owned) return NextResponse.json({ error: "This event no longer exists." }, { status: 404 });
    // The owner or an admin of the business may republish (the same people who can edit / delete the event).
    if (owned.ownerId !== user.id) {
      const [membership] = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(
        eq(teamMembers.businessProfileId, owned.event.businessProfileId), eq(teamMembers.userId, user.id), eq(teamMembers.role, "admin"),
      )).limit(1);
      if (!membership) return NextResponse.json({ error: "Only the business owner or an admin can republish this event." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "The republish request was empty. Please try again." }, { status: 400 });
    const paymentId = Number(body.paymentId);
    if (!paymentId) return NextResponse.json({ error: "Pay the publishing fee with PayChangu first, then republish." }, { status: 400 });

    // The fee belongs to this business (whoever on the team paid it). Re-read it after asking PayChangu,
    // so a payer who has just finished on PayChangu is never stuck behind a missed webhook.
    const loadPayment = async () => (await db.select().from(payments).where(and(
      eq(payments.id, paymentId), eq(payments.businessProfileId, owned.event.businessProfileId),
    )).limit(1))[0];
    let payment = await loadPayment();
    if (!payment) return NextResponse.json({ error: "That payment was not found for this business. Start a new publishing-fee payment." }, { status: 404 });
    if (payment.status === "pending" && payment.provider === PAYMENT_PROVIDER) {
      await settlePaychanguPayment(payment.id);
      payment = (await loadPayment()) ?? payment;
    }
    if (payment.status === "pending") {
      return NextResponse.json({ error: "PayChangu has not confirmed this payment yet. If you have approved it, wait a few seconds and press Verify again. You will not be charged twice.", paymentStatus: "pending" }, { status: 402 });
    }
    if (payment.status !== "succeeded") {
      return NextResponse.json({ error: "This payment did not go through. Please start a new publishing-fee payment.", paymentStatus: payment.status }, { status: 402 });
    }
    const meta = (payment.metadata ?? {}) as Record<string, unknown>;
    if (readAnyIntent(meta) || meta.paymentType !== "publishing-fee" || meta.reversed) return NextResponse.json({ error: "This payment cannot be used for publishing. Start a new publishing-fee payment." }, { status: 400 });
    if (payment.currency !== "MWK" || payment.amount < publishingFeeMwk()) return NextResponse.json({ error: `The publishing fee is MWK ${publishingFeeMwk().toLocaleString("en-US")}. Start a new publishing-fee payment.` }, { status: 402 });
    const alreadyUsed = await db.select({ id: events.id }).from(events).where(eq(events.paymentId, paymentId)).limit(1);
    if (alreadyUsed.length || meta.usedForEventId) return NextResponse.json({ error: "This publishing payment has already been used. Start a new publishing-fee payment to republish again." }, { status: 409 });

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
      // Spend the fee exactly once: a payment that already published or republished anything can never be reused,
      // even after events.payment_id moves on to a newer payment.
      const claimed = await tx.execute(sql`
        UPDATE payments
           SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ usedForEventId: eventId, usedAt: new Date().toISOString() })}::jsonb,
               updated_at = now()
         WHERE id = ${paymentId} AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'usedForEventId')
        RETURNING id`);
      if (!claimed.length) throw new Error("Publishing payment already used");
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
    await createAuditLog({ actorUserId: user.id, businessProfileId: owned.event.businessProfileId, action: "updated", resourceType: "event", resourceId: eventId, details: { republished: true, paymentId, tier, publishingFeePaidToPlatform: payment.amount } });
    return NextResponse.json({ ...updated, image: publicPosterUrl(updated.id, updated.image, updated.updatedAt) });
  } catch (error) {
    if (error instanceof Error && error.message === "Publishing payment already used") return NextResponse.json({ error: "This publishing payment has already been used. Start a new publishing-fee payment to republish again." }, { status: 409 });
    if (error instanceof Error && (/Invalid ticket type|Capacity for|Ticket types with/.test(error.message))) return NextResponse.json({ error: error.message }, { status: 400 });
    const code = (error as { code?: string; cause?: { code?: string } } | null)?.code ?? (error as { cause?: { code?: string } } | null)?.cause?.code;
    if (code === "23505") return NextResponse.json({ error: "This publishing payment has already been used. Start a new publishing-fee payment to republish again." }, { status: 409 });
    console.error("Republish event error:", error);
    return NextResponse.json({ error: "We could not republish the event just now. Your payment is safe and will not be charged again; please try Verify & republish once more." }, { status: 500 });
  }
}
