import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, events, payments, ticketTypes } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { createAuditLog } from "@/lib/audit";
import { eventTierFor, publishingFeeMwk } from "@/lib/fees";
import { hasPayoutAccount } from "@/lib/payouts";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { readAnyIntent } from "@/lib/purchase";
import { publicPosterUrl, validatePoster } from "@/lib/poster";

interface TicketInput {
  name?: string;
  price?: number;
  currency?: string;
  perks?: string[];
  capacity?: number;
}

const categories = ["event", "bus", "flight", "tourism"] as const;

export async function POST(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const businessProfileId = Number(body.businessProfileId);
    const paymentId = Number(body.paymentId);
    const startsAt = new Date(body.startsAt ?? body.date);
    const tickets: TicketInput[] = Array.isArray(body.tickets) ? body.tickets : body.tiers;

    if (!businessProfileId || !paymentId || !body.title || !body.location || Number.isNaN(startsAt.getTime())) {
      return NextResponse.json(
        { error: "businessProfileId, paymentId, title, location, startsAt, and tickets are required" },
        { status: 400 }
      );
    }
    if (!tickets?.length) return NextResponse.json({ error: "At least one ticket type is required" }, { status: 400 });
    const poster = validatePoster(body.image);
    if (!poster.ok) return NextResponse.json({ error: poster.error }, { status: 400 });
    if (!categories.includes(body.category ?? "event")) {
      return NextResponse.json({ error: "category must be event, bus, flight, or tourism" }, { status: 400 });
    }

    const [profile] = await db
      .select()
      .from(businessProfiles)
      .where(and(eq(businessProfiles.id, businessProfileId), eq(businessProfiles.userId, user.id)))
      .limit(1);
    if (!profile) return NextResponse.json({ error: "Business profile not found or not owned by user" }, { status: 404 });
    // Ticket money is paid straight to the organiser after every sale, so we need to know where to send it.
    if ((body.category ?? "event") !== "bus" && !hasPayoutAccount(profile)) {
      return NextResponse.json(
        { error: "Add your payout account (PUT /api/business/payout-details) before publishing, so ticket money can be sent to you." },
        { status: 400 },
      );
    }

    const [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.businessProfileId, businessProfileId), eq(payments.userId, user.id)))
      .limit(1);
    if (!payment) return NextResponse.json({ error: "Payment not found for this business" }, { status: 404 });
    if (payment.status !== "succeeded") return NextResponse.json({ error: "A successful payment is required" }, { status: 402 });
    // The payment must be a publishing fee: right amount, not a customer ticket purchase, not reversed, not already used.
    const paymentMeta = (payment.metadata ?? {}) as Record<string, unknown>;
    if (
      readAnyIntent(paymentMeta) ||
      paymentMeta.paymentType === "ticket-purchase" ||
      paymentMeta.reversed
    ) {
      return NextResponse.json({ error: "This payment cannot be used to publish a listing" }, { status: 400 });
    }
    if (paymentMeta.paymentType && paymentMeta.paymentType !== "publishing-fee") {
      return NextResponse.json({ error: "A publishing-fee payment is required" }, { status: 400 });
    }
    if (payment.currency !== "MWK" || payment.amount < publishingFeeMwk()) {
      return NextResponse.json({ error: `The publishing fee is MWK ${publishingFeeMwk()}` }, { status: 402 });
    }
    const [alreadyUsed] = await db.select({ id: events.id }).from(events).where(eq(events.paymentId, paymentId)).limit(1);
    if (alreadyUsed) return NextResponse.json({ error: "This payment has already been used to publish a listing" }, { status: 409 });

    const normalizedTickets = tickets.map((ticket) => {
      const capacity = Number(ticket.capacity);
      const price = Number(ticket.price);
      if (!ticket.name || !Number.isInteger(capacity) || capacity <= 0 || !Number.isInteger(price) || price < 0) {
        throw new Error("Each ticket requires a name, non-negative integer price, and positive integer capacity");
      }
      return {
        name: String(ticket.name).trim(),
        price,
        currency: String(ticket.currency ?? "MWK").toUpperCase(),
        perks: Array.isArray(ticket.perks) ? ticket.perks.map(String) : [],
        capacity,
        remaining: capacity,
      };
    });

    // Commission tier (small 5% / standard 7% / premium 8%) is decided here, on the server.
    const tier = eventTierFor({
      totalCapacity: normalizedTickets.reduce((n, t) => n + t.capacity, 0),
      maxTicketPrice: Math.max(...normalizedTickets.map((t) => t.price)),
    });

    const event = await db.transaction(async (transaction) => {
      const [createdEvent] = await transaction
        .insert(events)
        .values({
          businessProfileId,
          createdBy: user.id,
          paymentId,
          title: String(body.title).trim(),
          subtitle: body.subtitle ?? null,
          category: body.category ?? "event",
          organizer: body.organizer ?? null,
          description: body.description ?? null,
          location: String(body.location).trim(),
          venue: body.venue ?? null,
          city: body.city ?? null,
          countryCode: body.countryCode ?? null,
          startsAt,
          endsAt: body.endsAt ? new Date(body.endsAt) : null,
          image: poster.value,
          tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
          maxPerUser: Number.isInteger(Number(body.maxPerUser)) ? Number(body.maxPerUser) : 5,
          tier,
          status: body.status === "draft" ? "draft" : "published",
        })
        .returning();

      const createdTickets = await transaction
        .insert(ticketTypes)
        .values(normalizedTickets.map((ticket) => ({ ...ticket, eventId: createdEvent.id })))
        .returning();

      return { ...createdEvent, tickets: createdTickets };
    });

    await createAuditLog({
      actorUserId: user.id,
      businessProfileId,
      action: "created",
      resourceType: "event",
      resourceId: event.id,
      details: { paymentId, ticketTypeCount: event.tickets.length, status: event.status, tier },
    });

    return NextResponse.json({ ...event, image: publicPosterUrl(event.id, event.image, event.updatedAt) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Each ticket")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Create event error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const businessProfileId = Number(new URL(req.url).searchParams.get("businessProfileId"));
    if (!businessProfileId) return NextResponse.json({ error: "businessProfileId is required" }, { status: 400 });

    const [profile] = await db
      .select({ id: businessProfiles.id })
      .from(businessProfiles)
      .where(and(eq(businessProfiles.id, businessProfileId), eq(businessProfiles.userId, user.id)))
      .limit(1);
    if (!profile) return NextResponse.json({ error: "Business profile not found or not owned by user" }, { status: 404 });

    const records = await db.select().from(events).where(eq(events.businessProfileId, businessProfileId));
    return NextResponse.json(records.map((r) => ({ ...r, image: publicPosterUrl(r.id, r.image, r.updatedAt) })));
  } catch (error) {
    console.error("List events error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
