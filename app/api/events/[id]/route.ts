import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookings, businessProfiles, events, payouts, teamMembers, ticketTypes } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { createAuditLog } from "@/lib/audit";
import { publicPosterUrl, validatePoster } from "@/lib/poster";

const categories = ["event", "bus", "flight", "tourism"] as const;
interface TicketInput { id?: number; name?: string; price?: number; currency?: string; perks?: string[]; capacity?: number; remaining?: number; }
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
    const permittedFreeKeys = new Set(["startsAt", "date", "endsAt", "image"]);
    const attemptedContentEdit = Object.keys(body).some((key) => !permittedFreeKeys.has(key));
    if (attemptedContentEdit) {
      return NextResponse.json({ error: "Changing event or ticket information requires a new publishing-fee payment. Use POST /api/events/{id}/republish. Date extensions alone are free." }, { status: 402 });
    }
    const category = access.event.category;
    if (!categories.includes(category)) return NextResponse.json({ error: "category must be event, bus, flight, or tourism" }, { status: 400 });

    // image: omitted = keep, null/"" = remove, data URL = replace.
    let image = access.event.image;
    const keepsExisting = typeof body.image === "string" && body.image.startsWith("/api/events/");
    if (body.image !== undefined && !keepsExisting) {
      const poster = validatePoster(body.image);
      if (!poster.ok) return NextResponse.json({ error: poster.error }, { status: 400 });
      image = poster.value;
    }

    const startsAt = body.startsAt || body.date ? new Date(body.startsAt ?? body.date) : access.event.startsAt;
    if (Number.isNaN(startsAt.getTime())) return NextResponse.json({ error: "Invalid startsAt" }, { status: 400 });
    if (body.endsAt) {
      const endsAt = new Date(body.endsAt);
      if (Number.isNaN(endsAt.getTime()) || endsAt < startsAt) return NextResponse.json({ error: "Invalid event end date" }, { status: 400 });
    }

    const updated = await db.transaction(async (transaction) => {
      const [event] = await transaction.update(events).set({

        startsAt,
        endsAt: body.endsAt === null ? null : body.endsAt ? new Date(body.endsAt) : access.event.endsAt,
        image,
        updatedAt: new Date(),
      }).where(eq(events.id, eventId)).returning();

      const tickets = await transaction.select().from(ticketTypes).where(eq(ticketTypes.eventId, eventId));
      return { ...event, tickets };
    });

    await createAuditLog({ actorUserId: user.id, businessProfileId: access.event.businessProfileId, action: "updated", resourceType: "event", resourceId: eventId, details: { dateExtended: true } });
    return NextResponse.json({ ...updated, image: publicPosterUrl(updated.id, updated.image, updated.updatedAt) });
  } catch (error) {
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
    return NextResponse.json({ ...access.event, image: publicPosterUrl(access.event.id, access.event.image, access.event.updatedAt), tickets });
  } catch (error) {
    console.error("Get event error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}


/** DELETE /api/events/:id. Events with paid tickets are safely cancelled instead of erasing financial history. */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const eventId = Number((await params).id);
    if (!Number.isInteger(eventId)) return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
    const access = await getEventAdmin(eventId, user.id);
    if (!access) return NextResponse.json({ error: "Event not found or admin access required" }, { status: 404 });

    const ticketRows = await db.select({ id: ticketTypes.id }).from(ticketTypes).where(eq(ticketTypes.eventId, eventId));
    const ticketIds = ticketRows.map((row) => row.id);
    const paidBookings = ticketIds.length
      ? await db.select({ id: bookings.id }).from(bookings).where(inArray(bookings.ticketTypeId, ticketIds)).limit(1)
      : [];
    const payoutRows = await db.select({ id: payouts.id }).from(payouts).where(eq(payouts.eventId, eventId)).limit(1);

    if (paidBookings.length || payoutRows.length) {
      const [cancelled] = await db.update(events).set({ status: "cancelled", updatedAt: new Date() }).where(eq(events.id, eventId)).returning();
      await createAuditLog({ actorUserId: user.id, businessProfileId: access.event.businessProfileId, action: "updated", resourceType: "event", resourceId: eventId, details: { status: "cancelled", reason: "Protected paid-ticket financial history" } });
      return NextResponse.json({ success: true, deleted: false, cancelled: true, event: cancelled, message: "This event has paid ticket history, so it was cancelled rather than permanently deleted." });
    }

    await db.delete(events).where(eq(events.id, eventId));
    await createAuditLog({ actorUserId: user.id, businessProfileId: access.event.businessProfileId, action: "deleted", resourceType: "event", resourceId: eventId, details: { title: access.event.title } });
    return NextResponse.json({ success: true, deleted: true });
  } catch (error) {
    console.error("Delete event error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
