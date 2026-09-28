import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { parcels, scanEvents, ticketTypes } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { getProfileByUserId, parseId } from "@/lib/ownership";

const kinds = ["ticket", "parcel"] as const;
const modes = ["auto", "manual"] as const;

/**
 * Scan/validation log (all three ScanPanels: bus tickets, deliveries, entry).
 * POST /api/validations — resolve a scanned code and record the result.
 *   Body: {code required, kind required, mode?, device?, synced?, occurredAt?}
 *   Duplicate = the same code already has a prior valid scan on this profile.
 * GET /api/validations — validation log for the owned profile, newest first.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const body = await req.json();
    if (!body.code || !body.kind) {
      return NextResponse.json({ error: "code and kind are required" }, { status: 400 });
    }
    const kind = body.kind;
    if (!kinds.includes(kind)) {
      return NextResponse.json({ error: "kind must be ticket or parcel" }, { status: 400 });
    }
    const mode = body.mode ?? "auto";
    if (!modes.includes(mode)) {
      return NextResponse.json({ error: "mode must be auto or manual" }, { status: 400 });
    }

    const code = String(body.code);
    const occurredAt = body.occurredAt && !Number.isNaN(new Date(body.occurredAt).getTime())
      ? new Date(body.occurredAt)
      : new Date();

    // Resolve the code: ticket via ticket_types.id (numeric codes) or parcel
    // via reference. Also detect duplicates from prior valid scans.
    let exists = false;
    if (kind === "parcel") {
      const [parcel] = await db
        .select({ id: parcels.id })
        .from(parcels)
        .where(and(eq(parcels.reference, code), eq(parcels.businessProfileId, profile.id)))
        .limit(1);
      exists = Boolean(parcel);
    } else {
      const numericId = parseId(code.replace(/\D/g, ""));
      if (numericId) {
        const [ticket] = await db
          .select({ id: ticketTypes.id })
          .from(ticketTypes)
          .innerJoin(parcels, eq(ticketTypes.eventId, parcels.id))
          .where(eq(ticketTypes.id, numericId))
          .limit(1);
        exists = Boolean(ticket);
      }
    }

    const [priorValid] = await db
      .select({ id: scanEvents.id })
      .from(scanEvents)
      .where(
        and(
          eq(scanEvents.businessProfileId, profile.id),
          eq(scanEvents.code, code),
          eq(scanEvents.result, "valid")
        )
      )
      .limit(1);

    const result = priorValid ? "duplicate" : exists ? "valid" : "invalid";

    const [created] = await db
      .insert(scanEvents)
      .values({
        businessProfileId: profile.id,
        code,
        kind,
        result,
        mode,
        device: body.device ?? null,
        synced: body.synced === undefined ? true : Boolean(body.synced),
        occurredAt,
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error("Record validation error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const profile = await getProfileByUserId(user.id);
    if (!profile) return NextResponse.json({ error: "Business profile not found" }, { status: 404 });

    const rows = await db
      .select()
      .from(scanEvents)
      .where(eq(scanEvents.businessProfileId, profile.id))
      .orderBy(desc(scanEvents.occurredAt))
      .limit(200);

    return NextResponse.json({ validations: rows });
  } catch (err) {
    console.error("List validations error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
