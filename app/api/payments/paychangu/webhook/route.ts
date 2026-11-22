import { NextRequest, NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments } from "@/drizzle/schema";
import { settlePaychanguPayment, verifyWebhookSignature } from "@/lib/paychangu";

// Webhook receiver for PayChangu. Register in the PayChangu dashboard (Settings -> API & Webhooks):
//   https://<your-api-host>/api/payments/paychangu/webhook
// The payload is only used to find our payment; its status is re-checked with PayChangu's
// verify endpoint, so the body is never trusted on its own.
export async function POST(req: NextRequest) {
  const raw = await req.text(); // RAW body: required for the signature check
  if (!verifyWebhookSignature(raw, req.headers.get("signature"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const meta = (data.meta ?? {}) as Record<string, unknown>;
  const refs = [data.tx_ref, data.charge_id, data.reference, meta.tx_ref].filter((v): v is string => typeof v === "string" && v.length > 0);
  if (!refs.length) return NextResponse.json({ received: true, matched: false });

  const [payment] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(or(...refs.map((r) => eq(payments.reference, r))))
    .limit(1);
  // 200 so PayChangu doesn't retry forever for references that aren't ours.
  if (!payment) return NextResponse.json({ received: true, matched: false });

  await settlePaychanguPayment(payment.id);
  return NextResponse.json({ received: true });
}
