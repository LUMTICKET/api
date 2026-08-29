import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { businessProfiles } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    // Validate required fields
    if (!body.businessName || !body.email || !body.phone || !body.address || !body.city || !body.country) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Check if user already has a profile
    const existing = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.userId, user.id))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Business profile already exists" },
        { status: 409 }
      );
    }

    const [profile] = await db
      .insert(businessProfiles)
      .values({
        userId: user.id,
        type: body.type || "individual",
        businessName: body.businessName,
        tradingName: body.tradingName || null,
        registrationNumber: body.registrationNumber || null,
        taxId: body.taxId || null,
        email: body.email,
        phone: body.phone,
        address: body.address,
        city: body.city,
        country: body.country,
        website: body.website || null,
        description: body.description || null,
        category: body.category || null,
        isVerified: false,
        executives: body.executives || [],
        documents: body.documents || [],
      })
      .returning();

    return NextResponse.json(profile, { status: 201 });
  } catch (err) {
    console.error("KYB create error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/** Get current user's own business profile */
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [profile] = await db
      .select()
      .from(businessProfiles)
      .where(eq(businessProfiles.userId, user.id))
      .limit(1);

    if (!profile) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(profile);
  } catch (err) {
    console.error("KYB get error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}