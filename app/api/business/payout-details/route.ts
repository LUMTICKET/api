import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessProfiles } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId } from "@/lib/ownership";
import { hasPayoutAccount } from "@/lib/payouts";
import { normalizeMsisdn } from "@/lib/paychangu";

const methods = ["tnm", "airtel", "bank"] as const;
type Method = (typeof methods)[number];

/**
 * Where an organiser's ticket money is sent right after every purchase.
 *   GET /api/business/payout-details
 *   PUT /api/business/payout-details  { method: tnm|airtel|bank, accountName, accountNumber, bankUuid? }
 * tnm / airtel: accountNumber is the mobile money number. bank: accountNumber + bankUuid (from PayChangu's bank list).
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });
    return NextResponse.json({
      configured: hasPayoutAccount(profile),
      method: profile.payoutMethod,
      accountName: profile.payoutAccountName,
      accountNumber: profile.payoutAccountNumber,
      bankUuid: profile.payoutBankUuid,
    });
  } catch (err) {
    console.error("Get payout details error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const body = await req.json().catch(() => null);
    const method = body?.method as Method;
    const accountName = String(body?.accountName ?? "").trim().slice(0, 255);
    if (!methods.includes(method)) return NextResponse.json({ error: "method must be tnm, airtel, or bank" }, { status: 400 });
    if (!accountName) return NextResponse.json({ error: "accountName is required" }, { status: 400 });

    let accountNumber: string;
    let bankUuid: string | null = null;
    if (method === "bank") {
      accountNumber = String(body?.accountNumber ?? "").replace(/\s+/g, "");
      bankUuid = String(body?.bankUuid ?? "").trim() || null;
      if (!/^\d{5,30}$/.test(accountNumber)) return NextResponse.json({ error: "Enter a valid bank account number" }, { status: 400 });
      if (!bankUuid) return NextResponse.json({ error: "bankUuid is required for bank payouts" }, { status: 400 });
    } else {
      const msisdn = normalizeMsisdn(body?.accountNumber);
      if (!msisdn) return NextResponse.json({ error: "Enter a valid Malawian mobile money number, e.g. 0999 123 456" }, { status: 400 });
      accountNumber = msisdn;
    }

    await db
      .update(businessProfiles)
      .set({ payoutMethod: method, payoutAccountName: accountName, payoutAccountNumber: accountNumber, payoutBankUuid: bankUuid, updatedAt: new Date() })
      .where(eq(businessProfiles.id, profile.id));

    // Any sales that were waiting for these details are paid out now.
    const { retryOpenPayouts } = await import("@/lib/payouts");
    await retryOpenPayouts().catch((e) => console.error("Payout retry after details saved failed:", e));

    return NextResponse.json({ configured: true, method, accountName, accountNumber, bankUuid });
  } catch (err) {
    console.error("Save payout details error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
