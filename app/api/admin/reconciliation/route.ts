import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { reconciliationFlags } from "@/drizzle/schema";
import { createPlatformAudit, getPlatformUser } from "@/lib/admin";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { parseId } from "@/lib/ownership";

const statuses = ["auto-refunded", "booking-completed", "needs-review"] as const;

/**
 * Payment reconciliation (admin PlatformReconciliationPanel + agent EndOfDay).
 * GET /api/admin/reconciliation — flags, newest first.
 * POST /api/admin/reconciliation — {gatewayRef required, amount?, currency?, issue?}.
 * PATCH /api/admin/reconciliation?id=<id> — {status} resolves the flag.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rows = await db
      .select()
      .from(reconciliationFlags)
      .orderBy(desc(reconciliationFlags.detectedAt));

    return NextResponse.json({ flags: rows });
  } catch (err) {
    console.error("List reconciliation flags error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    if (!body.gatewayRef) {
      return NextResponse.json({ error: "gatewayRef is required" }, { status: 400 });
    }

    const [created] = await db
      .insert(reconciliationFlags)
      .values({
        gatewayRef: String(body.gatewayRef),
        amount: Number.isInteger(Number(body.amount)) ? Number(body.amount) : 0,
        currency: String(body.currency ?? "MWK").toUpperCase().slice(0, 3),
        issue: body.issue ?? null,
        status: statuses.includes(body.status) ? body.status : "needs-review",
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Create reconciliation flag error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = parseId(new URL(req.url).searchParams.get("id") ?? "");
    if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

    const body = await req.json();
    const status = body.status;
    if (!statuses.includes(status)) {
      return NextResponse.json({ error: "status must be auto-refunded, booking-completed, or needs-review" }, { status: 400 });
    }

    const [updated] = await db
      .update(reconciliationFlags)
      .set({ status })
      .where(eq(reconciliationFlags.id, id))
      .returning();

    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await createPlatformAudit(
      user.email ?? `user-${user.id}`,
      status === "auto-refunded" ? "Issued refund" : `Reconciliation: ${status}`,
      `flag/${updated.gatewayRef}`
    );

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Update reconciliation flag error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
