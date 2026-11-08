import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { fulfilTicketPurchase, readIntent } from "@/lib/purchase";

/**
 * GET /api/checkout/tickets/:paymentId — the buyer polls this after starting a payment.
 * -> { status: "pending" | "failed" }
 * -> { status: "succeeded", booking }          ticket issued (reference = QR payload)
 * -> { status: "succeeded", problem: "sold-out" }  paid but stock ran out; flagged for refund
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = Number((await params).paymentId);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [payment] = await db.select().from(payments).where(and(eq(payments.id, id), eq(payments.userId, user.id))).limit(1);
    if (!payment || !readIntent(payment.metadata)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (payment.status !== "succeeded") return NextResponse.json({ status: payment.status });

    const result = await fulfilTicketPurchase(payment.id);
    if (result.booking) return NextResponse.json({ status: "succeeded", booking: result.booking });
    return NextResponse.json({ status: "succeeded", problem: result.problem });
  } catch (err) {
    console.error("Ticket checkout status error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
