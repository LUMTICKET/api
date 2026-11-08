import { NextRequest, NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments } from "@/drizzle/schema";
import { verifyWebhook } from "@/lib/onekhusa";
import { createAuditLog } from "@/lib/audit";

// Webhook receiver for pushpayment.success | pushpayment.failed | pushpayment.reversed.
// Register this URL in OneKhusa portal -> Developers -> Webhooks (one webhook per event).
export async function POST(req: NextRequest) {
  const raw = await req.text(); // RAW body: required for signature check
  const event = req.headers.get("x-onekhusa-webhook-event");
  const signature = req.headers.get("x-onekhusa-webhook-signature");

  if (!verifyWebhook(raw, event, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Failed payloads only carry merchantReferenceNumber, so match on either field.
  const refs = [data.merchantReferenceNumber, data.sourceReferenceNumber].filter((v): v is string => typeof v === "string");
  if (!refs.length) return NextResponse.json({ error: "No reference" }, { status: 400 });

  const [payment] = await db
    .select()
    .from(payments)
    .where(or(...refs.map((r) => eq(payments.reference, r))))
    .limit(1);
  // 200 so OneKhusa doesn't retry forever for references that aren't ours.
  if (!payment) return NextResponse.json({ received: true, matched: false });

  // Reversal has no own status in the schema: it flips back to "failed" with metadata.reversed = true.
  const next = event === "pushpayment.success" ? "succeeded" : "failed";

  // Never downgrade a succeeded payment on a late/duplicate "failed"; reversals are allowed.
  if (payment.status === "succeeded" && event === "pushpayment.failed") return NextResponse.json({ received: true });
  if (payment.status === next) return NextResponse.json({ received: true, duplicate: true });

  const meta = { ...((payment.metadata as Record<string, unknown>) ?? {}), lastEvent: event, webhook: data };
  await db
    .update(payments)
    .set({
      status: next,
      paidAt: event === "pushpayment.success" ? new Date() : payment.paidAt,
      metadata: event === "pushpayment.reversed" ? { ...meta, reversed: true } : meta,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, payment.id));

  await createAuditLog({
    actorUserId: null,
    businessProfileId: payment.businessProfileId,
    action: event!.split(".")[1],
    resourceType: "payment",
    resourceId: payment.id,
    details: { event, reference: payment.reference, transactionReferenceNumber: data.transactionReferenceNumber ?? null },
  });

  return NextResponse.json({ received: true });
}
