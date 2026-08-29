import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { businessProfiles } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { eq, and } from "drizzle-orm";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const profileId = parseInt(id, 10);
    if (isNaN(profileId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const [profile] = await db
      .select()
      .from(businessProfiles)
      .where(
        and(
          eq(businessProfiles.id, profileId),
          eq(businessProfiles.userId, user.id)
        )
      )
      .limit(1);

    if (!profile) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(profile);
  } catch (err) {
    console.error("KYB single get error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const profileId = parseInt(id, 10);
    if (isNaN(profileId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const body = await req.json();

    // Verify ownership
    const [existing] = await db
      .select()
      .from(businessProfiles)
      .where(
        and(
          eq(businessProfiles.id, profileId),
          eq(businessProfiles.userId, user.id)
        )
      )
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [updated] = await db
      .update(businessProfiles)
      .set({
        type: body.type ?? existing.type,
        businessName: body.businessName ?? existing.businessName,
        tradingName: body.tradingName ?? existing.tradingName,
        registrationNumber:
          body.registrationNumber !== undefined
            ? body.registrationNumber
            : existing.registrationNumber,
        taxId: body.taxId !== undefined ? body.taxId : existing.taxId,
        email: body.email ?? existing.email,
        phone: body.phone ?? existing.phone,
        address: body.address ?? existing.address,
        city: body.city ?? existing.city,
        country: body.country ?? existing.country,
        website: body.website !== undefined ? body.website : existing.website,
        description:
          body.description !== undefined ? body.description : existing.description,
        category: body.category !== undefined ? body.category : existing.category,
        executives: body.executives ?? existing.executives,
        documents: body.documents ?? existing.documents,
        updatedAt: new Date(),
      })
      .where(eq(businessProfiles.id, profileId))
      .returning();

    return NextResponse.json(updated);
  } catch (err) {
    console.error("KYB update error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const profileId = parseInt(id, 10);
    if (isNaN(profileId)) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(businessProfiles)
      .where(
        and(
          eq(businessProfiles.id, profileId),
          eq(businessProfiles.userId, user.id)
        )
      )
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db
      .delete(businessProfiles)
      .where(eq(businessProfiles.id, profileId));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("KYB delete error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}