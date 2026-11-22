import { NextResponse } from "next/server";
import { mobileMoneyAvailable, PAYMENT_PROVIDER } from "@/lib/paychangu";

/**
 * GET /api/checkout/config (public) - tells the front end how to collect payment through PayChangu.
 * One interface for ticket buyers and business owners paying the publishing fee:
 *  - hosted: false -> show our own screen: pick TNM / Airtel (+ phone) for a PIN prompt, or card (secure page).
 *  - hosted: true  -> mobile money can't be charged directly right now; everything goes through PayChangu's page.
 */
export async function GET() {
  const hosted = !(await mobileMoneyAvailable());
  return NextResponse.json({ provider: PAYMENT_PROVIDER, hosted, methods: hosted ? ["card"] : ["tnm", "airtel", "card"] });
}
