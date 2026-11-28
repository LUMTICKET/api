import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, payments, payouts, settlements } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId } from "@/lib/ownership";

/**
 * Finance & settlements (every business role's FinancePanel).
 * GET /api/finance/settlements — settlements for the owned profile,
 * newest period first. Optionally filter with ?status=pending|paid.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const status = new URL(req.url).searchParams.get("status");
    if (status && status !== "pending" && status !== "paid") {
      return NextResponse.json({ error: "status must be pending or paid" }, { status: 400 });
    }

    const typedStatus = status as "pending" | "paid";
    const rows = await db
      .select()
      .from(settlements)
      .where(
        status
          ? and(eq(settlements.businessProfileId, profile.id), eq(settlements.status, typedStatus))
          : eq(settlements.businessProfileId, profile.id)
      )
      .orderBy(desc(settlements.periodStart));

    // Live financial position is derived from verified ticket-payment payout rows.
    // Publishing-fee payments never create payout rows, so they cannot inflate sales/commission.
    const livePayouts = await db
      .select()
      .from(payouts)
      .where(eq(payouts.businessProfileId, profile.id))
      .orderBy(desc(payouts.createdAt));
    const live = livePayouts.reduce((acc, row) => {
      acc.grossSales += row.grossAmount;
      acc.commissionEarned += row.commissionAmount;
      acc.netPayouts += row.netAmount;
      if (!["sent", "paid"].includes(row.status)) acc.pendingPayouts += 1;
      return acc;
    }, { grossSales: 0, commissionEarned: 0, publishingFeesPaid: 0, netPayouts: 0, pendingPayouts: 0 });
    const [successfulPayments, publishedEvents] = await Promise.all([
      db.select().from(payments).where(and(eq(payments.businessProfileId, profile.id), eq(payments.status, "succeeded"))),
      db.select({ paymentId: events.paymentId }).from(events).where(eq(events.businessProfileId, profile.id)),
    ]);
    const usedPublishingPaymentIds = new Set(publishedEvents.map((event) => event.paymentId));
    const publishingFeesPaid = successfulPayments.reduce((sum, payment) => {
      const metadata = (payment.metadata ?? {}) as Record<string, unknown>;
      const intent = metadata.intent && typeof metadata.intent === "object" ? metadata.intent as Record<string, unknown> : null;
      const isPublishingFee = !intent && (metadata.paymentType === "publishing-fee" || usedPublishingPaymentIds.has(payment.id));
      return sum + (isPublishingFee ? payment.amount : 0);
    }, 0);
    live.publishingFeesPaid = publishingFeesPaid;

    return NextResponse.json({
      settlements: rows,
      live,
      payouts: livePayouts.slice(0, 200).map(({ lastError: _lastError, ...row }) => row),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("List settlements error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
