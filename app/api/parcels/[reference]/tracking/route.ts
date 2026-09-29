import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, parcelEvents, parcels } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";

/**
 * GET /api/parcels/:reference/tracking — public parcel tracking timeline.
 * Returns the parcel summary and its scan events in chronological order.
 * Authenticated owners see full names; anonymous callers get masked names.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  try {
    await ensureOperationalSchema();
    const { reference } = await params;

    const [parcel] = await db
      .select()
      .from(parcels)
      .where(eq(parcels.reference, reference))
      .limit(1);

    if (!parcel) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const events = await db
      .select()
      .from(parcelEvents)
      .where(eq(parcelEvents.parcelId, parcel.id))
      .orderBy(asc(parcelEvents.occurredAt));

    const user = await getCurrentUser(req);
    let isOwner = false;
    if (user) {
      const [owned] = await db
        .select({ id: businessProfiles.id })
        .from(businessProfiles)
        .where(
          and(
            eq(businessProfiles.id, parcel.businessProfileId),
            eq(businessProfiles.userId, user.id)
          )
        )
        .limit(1);
      isOwner = Boolean(owned);
    }

    return NextResponse.json({
      reference: parcel.reference,
      status: parcel.status,
      origin: parcel.origin,
      destination: parcel.destination,
      senderName: isOwner ? parcel.senderName : mask(parcel.senderName),
      recipientName: isOwner ? parcel.recipientName : mask(parcel.recipientName),
      weightKg: parcel.weightKg,
      amount: isOwner ? parcel.amount : undefined,
      currency: parcel.currency,
      timeline: events.map((event) => ({
        location: event.location,
        status: event.status,
        scannedBy: event.scannedBy,
        occurredAt: event.occurredAt,
      })),
    });
  } catch (err) {
    console.error("Track parcel error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

function mask(name: string) {
  return `${name.slice(0, 1)}***`;
}
