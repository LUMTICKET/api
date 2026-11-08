import { NextResponse } from "next/server";
import { publishingFeeMwk } from "@/lib/fees";

/** GET /api/payments/publishing-fee — public. The business app shows and charges exactly this amount. */
export async function GET() {
  return NextResponse.json({ amount: publishingFeeMwk(), currency: "MWK" });
}
