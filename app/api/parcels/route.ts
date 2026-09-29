import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, couriers, parcelEvents, parcels } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";

const BASE_FEE = 5000; // minor units
const PER_KG = 2500; // minor units per kg

/**
 * GET /api/parcels — courier operator's parcel queue (owned profile).
 * POST /api/parcels — create a parcel (send flow). Computes amount from
 * weight (base fee + per-kg) when amount is not supplied; writes the first
 * parcel_events row so tracking has a timeline from birth.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await getOwnedProfileForRequest(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const rows = await db
      .select({
        id: parcels.id,
        reference: parcels.reference,
        senderName: parcels.senderName,
        recipientName: parcels.recipientName,
        origin: parcels.origin,
        destination: parcels.destination,
        weightKg: parcels.weightKg,
        status: parcels.status,
        courierId: parcels.courierId,
        courierName: couriers.name,
        amount: parcels.amount,
        currency: parcels.currency,
        createdAt: parcels.createdAt,
      })
      .from(parcels)
      .leftJoin(couriers, eq(parcels.courierId, couriers.id))
      .where(eq(parcels.businessProfileId, profile.id))
      .orderBy(desc(parcels.createdAt));

    return NextResponse.json({ parcels: rows });
  } catch (err) {
    console.error("List parcels error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    if (!body.senderName || !body.recipientName || !body.origin || !body.destination) {
      return NextResponse.json(
        { error: "senderName, recipientName, origin, and destination are required" },
        { status: 400 }
      );
    }

    // Sender pays from their own profile; courier operators create on their profile.
    const profile = await getOwnedProfileForRequest(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const weightKg = body.weightKg !== undefined ? Number(body.weightKg) : null;
    if (weightKg !== null && (!Number.isFinite(weightKg) || weightKg < 0)) {
      return NextResponse.json({ error: "weightKg must be a non-negative number" }, { status: 400 });
    }

    const amount =
      body.amount !== undefined && Number.isInteger(Number(body.amount))
        ? Number(body.amount)
        : Math.round(BASE_FEE + (weightKg ?? 0) * PER_KG);

    const [created] = await db
      .insert(parcels)
      .values({
        businessProfileId: profile.id,
        reference: body.reference ?? `LMT-PCL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        senderName: String(body.senderName),
        recipientName: String(body.recipientName),
        origin: String(body.origin),
        destination: String(body.destination),
        weightKg: weightKg !== null ? weightKg.toFixed(2) : null,
        courierId: body.courierId ?? null,
        status: "registered",
        amount,
        currency: String(body.currency ?? "MWK").toUpperCase().slice(0, 3),
      })
      .returning();

    await db.insert(parcelEvents).values({
      parcelId: created.id,
      location: created.origin,
      status: "registered",
      scannedBy: user.email,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Create parcel error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

async function getOwnedProfileForRequest(userId: number) {
  const [profile] = await db
    .select()
    .from(businessProfiles)
    .where(eq(businessProfiles.userId, userId))
    .limit(1);
  return profile ?? null;
}
