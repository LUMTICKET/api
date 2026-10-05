import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles, payments } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";

const paymentMethods = ["card", "tnm", "airtel"] as const;

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { businessProfileId, amount, currency = "MWK", method = "card" } = await req.json();
    const numericAmount = Number(amount);

    if (!businessProfileId || !Number.isInteger(numericAmount) || numericAmount <= 0) {
      return NextResponse.json(
        { error: "businessProfileId and a positive integer amount are required" },
        { status: 400 }
      );
    }
    if (!paymentMethods.includes(method)) {
      return NextResponse.json({ error: "method must be card, tnm, or airtel" }, { status: 400 });
    }

    const [profile] = await db
      .select({ id: businessProfiles.id })
      .from(businessProfiles)
      .where(and(eq(businessProfiles.id, Number(businessProfileId)), eq(businessProfiles.userId, user.id)))
      .limit(1);

    if (!profile) {
      return NextResponse.json({ error: "Business profile not found or not owned by user" }, { status: 404 });
    }

    const [payment] = await db
      .insert(payments)
      .values({
        businessProfileId: profile.id,
        userId: user.id,
        provider: "simulation",
        method,
        amount: numericAmount,
        currency: String(currency).toUpperCase(),
        status: "succeeded",
        reference: `SIM-${crypto.randomUUID()}`,
        metadata: { simulated: true },
        paidAt: new Date(),
      })
      .returning();

    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    console.error("Simulate payment error:", error);
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

    const records = await db.select().from(payments).where(eq(payments.businessProfileId, businessProfileId));
    return NextResponse.json(records);
  } catch (error) {
    console.error("List payments error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
