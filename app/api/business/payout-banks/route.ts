import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-kyb";
import { listSupportedBanks } from "@/lib/paychangu";

/** GET /api/business/payout-banks — banks an organiser can choose for bank payouts ({ banks: [{ uuid, name }] }). */
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ banks: await listSupportedBanks() });
  } catch (err) {
    console.error("List payout banks error:", err);
    return NextResponse.json({ banks: [], error: "Could not load banks right now. Mobile money payouts still work." }, { status: 200 });
  }
}
