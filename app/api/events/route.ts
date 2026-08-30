import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, events, payments, ticketTypes } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { createAuditLog } from "@/lib/audit";

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
    if (!categories.includes(body.category ?? "event")) {
      return NextResponse.json({ error: "category must be event, bus, flight, or tourism" }, { status: 400 });
    }

    const [profile] = await db
      .select({ id: businessProfiles.id })
      .from(businessProfiles)
      .where(and(eq(businessProfiles.id, businessProfileId), eq(businessProfiles.userId, user.id)))
      .limit(1);
    if (!profile) return NextResponse.json({ error: "Business profile not found or not owned by user" }, { status: 404 });

    const [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.businessProfileId, businessProfileId), eq(payments.userId, user.id)))
      .limit(1);
    if (!payment) return NextResponse.json({ error: "Payment not found for this business" }, { status: 404 });
    if (payment.status !== "succeeded") return NextResponse.json({ error: "A successful payment is required" }, { status: 402 });

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
          startsAt,
          endsAt: body.endsAt ? new Date(body.endsAt) : null,
          image: body.image ?? null,
          tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
          maxPerUser: Number.isInteger(Number(body.maxPerUser)) ? Number(body.maxPerUser) : 5,
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
      details: { paymentId, ticketTypeCount: event.tickets.length, status: event.status },
    });

    return NextResponse.json(event, { status: 201 });
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
    return NextResponse.json(records);
  } catch (error) {
    console.error("List events error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
