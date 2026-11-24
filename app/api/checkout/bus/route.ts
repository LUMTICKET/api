import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { busRoutes, businessProfiles, payments, schedules } from "@/drizzle/schema";
import { getCurrentUser } from "@/lib/auth-kyb";
import { ensureOperationalSchema } from "@/lib/ensure-schema";
import { normalizeMsisdn, PAYMENT_PROVIDER, PaychanguError, paychanguErrorDetail, startPaychanguPayment } from "@/lib/paychangu";
import { getSeatState, parseSeatLabels, SEAT_HOLD_MINUTES } from "@/lib/bus-seats";
import type { BusPurchaseIntent } from "@/lib/purchase";

const methods = ["card", "tnm", "airtel"] as const;

/**
 * POST /api/checkout/bus — a signed-in customer buys specific seats on one departure.
 * Body: { scheduleId, seats: ["3","4"], method?: tnm|airtel|card, phone? }
 *
 * The SERVER prices the order (route fare x seats), checks every seat is free and reserves them for
 * SEAT_HOLD_MINUTES while the customer pays. The booking is created only after PayChangu confirms
 * the payment (see fulfilBusPurchase in lib/purchase.ts). Poll GET /api/checkout/tickets/:paymentId.
 */
export async function POST(req: NextRequest) {
  try {
    await ensureOperationalSchema();
    const user = await getCurrentUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const scheduleId = Number(body?.scheduleId);
    const method = body?.method ?? "card";
    const phone = method === "card" || !body?.phone ? null : normalizeMsisdn(body.phone);

    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      return NextResponse.json({ error: "scheduleId is required" }, { status: 400 });
    }
    if (!methods.includes(method)) {
      return NextResponse.json({ error: "method must be card, tnm, or airtel" }, { status: 400 });
    }
    if (method !== "card" && body?.phone && !phone) {
      return NextResponse.json({ error: "Enter a valid Malawian mobile money number, e.g. 0999 123 456" }, { status: 400 });
    }

    const [row] = await db
      .select({ schedule: schedules, route: busRoutes, operator: businessProfiles.businessName })
      .from(schedules)
      .innerJoin(busRoutes, eq(schedules.routeId, busRoutes.id))
      .innerJoin(businessProfiles, eq(busRoutes.businessProfileId, businessProfiles.id))
      .where(eq(schedules.id, scheduleId))
      .limit(1);
    if (!row || !row.route.isPublished || row.schedule.status !== "scheduled" || row.schedule.departureAt <= new Date()) {
      return NextResponse.json({ error: "This departure is no longer on sale" }, { status: 404 });
    }
    if (row.route.currency.toUpperCase() !== "MWK") {
      return NextResponse.json({ error: "Only MWK is supported" }, { status: 400 });
    }

    const seats = parseSeatLabels(body?.seats, row.schedule.seatsTotal);
    if (!seats) {
      return NextResponse.json({ error: "Choose between 1 and 6 valid seats" }, { status: 400 });
    }

    const { sold, held } = await getSeatState(scheduleId);
    const clash = seats.filter((s) => sold.has(s) || held.has(s));
    if (clash.length) {
      return NextResponse.json(
        { error: `Seat ${clash.join(", ")} ${clash.length > 1 ? "were" : "was"} just taken. Please pick another.`, taken: clash },
        { status: 409 },
      );
    }
    if (row.schedule.seatsSold + held.size + seats.length > row.schedule.seatsTotal) {
      return NextResponse.json({ error: "Not enough seats left on this departure" }, { status: 409 });
    }

    const fare = row.route.fromPrice ?? 0;
    const amount = fare * seats.length;
    if (!Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: "This trip cannot be purchased online" }, { status: 400 });
    }

    const routeTitle = `${row.route.origin} → ${row.route.destination}`;
    const intent: BusPurchaseIntent = {
      kind: "bus-purchase",
      scheduleId,
      routeId: row.route.id,
      seats,
      routeTitle,
      operator: row.operator,
    };
    const reference = `LT${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const narrative = `Seat ${seats.join(", ")} - ${routeTitle}`.slice(0, 100);

    const [payment] = await db
      .insert(payments)
      .values({
        businessProfileId: row.schedule.businessProfileId,
        userId: user.id,
        provider: PAYMENT_PROVIDER,
        method,
        amount,
        currency: "MWK",
        status: "pending",
        reference,
        metadata: { intent },
      })
      .returning();

    try {
      const r = await startPaychanguPayment({
        paymentId: payment.id,
        reference,
        method,
        phone,
        amount,
        title: routeTitle,
        description: narrative,
        email: user.email,
        name: user.name,
        baseMetadata: { intent },
        audience: "buyer",
      });
      return NextResponse.json(
        {
          paymentId: payment.id,
          provider: PAYMENT_PROVIDER,
          status: "pending",
          amount,
          currency: "MWK",
          seats,
          holdMinutes: SEAT_HOLD_MINUTES,
          ...(r.checkoutUrl ? { checkoutUrl: r.checkoutUrl } : {}),
        },
        { status: 201 },
      );
    } catch (err) {
      await db
        .update(payments)
        .set({ status: "failed", metadata: { intent, initiationError: err instanceof PaychanguError ? err.body : String(err) }, updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
      if (err instanceof PaychanguError) {
        console.error("PayChangu rejected bus payment:", err.status, err.body);
        return NextResponse.json(
          { error: paychanguErrorDetail(err.body) ?? "PayChangu could not start the payment", paymentId: payment.id, providerStatus: err.status },
          { status: err.status >= 400 && err.status < 500 ? 400 : 502 },
        );
      }
      console.error("Bus checkout initiation error:", err);
      return NextResponse.json({ error: "Could not start the payment. Please try again.", paymentId: payment.id }, { status: 502 });
    }
  } catch (err) {
    console.error("Bus checkout error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
