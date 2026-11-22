import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { commissionRules } from "@/drizzle/schema";
import { createPlatformAudit, getPlatformUser } from "@/lib/admin";
import { ensureOperationalSchema } from "@/lib/ensure-schema";

const services = ["bus", "events", "parcels", "agent", "gateway"] as const;

/**
 * Platform commission rules (admin CommissionPanel).
 * GET /api/admin/commission — current rules
 * PUT /api/admin/commission — {service, rate} upserts the rule and audits the change.
 */
export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rules = await db
      .select()
      .from(commissionRules)
      .orderBy(asc(commissionRules.service));

    return NextResponse.json({ rules });
  } catch (err) {
    console.error("List commission rules error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getPlatformUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const service = body.service;
    if (!services.includes(service)) {
      return NextResponse.json({ error: "service must be bus, events, parcels, agent, or gateway" }, { status: 400 });
    }

    const rate = Number(body.rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return NextResponse.json({ error: "rate must be between 0 and 100" }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(commissionRules)
      .where(eq(commissionRules.service, service))
      .limit(1);

    const [updated] = await db
      .update(commissionRules)
      .set({ rate: rate.toFixed(2), effectiveFrom: new Date() })
      .where(eq(commissionRules.service, service))
      .returning();

    await createPlatformAudit(
      user.email ?? `user-${user.id}`,
      `Changed commission (${service}) ${existing ? `${existing.rate}% → ${rate}%` : `→ ${rate}%`}`,
      `commission/${service}`
    );

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Update commission rule error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
