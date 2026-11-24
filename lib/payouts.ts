// Organiser payouts.
//
// Money flow for every ticket purchase:
//   1. The buyer pays the FULL ticket price into Lumticket's PayChangu account (lib/paychangu.ts).
//   2. Once the ticket is issued, Lumticket keeps its commission (5% small / 7% standard / 8% premium
//      event, see lib/fees.ts) and the rest is sent to the organiser's payout account at once.
//
// One `payouts` row per payment (payment_id is unique) holds the split, and its charge_id is what is
// sent to PayChangu, so a retry or a double webhook can never pay an organiser twice.
import { and, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookings, businessProfiles, events, payments, payouts, users, type Payout } from "@/drizzle/schema";
import { sendPayoutDetailsNeededEmail, sendPayoutSentEmail } from "@/lib/email";
import { isEventTier, splitTicketAmount, type EventTier } from "@/lib/fees";
import { getPayoutState, normalizeMsisdn, operatorRefFor, PaychanguError, paychanguErrorDetail, sendBankPayout, sendMobileMoneyPayout } from "@/lib/paychangu";
import { readIntent } from "@/lib/purchase";
import { createAuditLog } from "@/lib/audit";

const MAX_ATTEMPTS = 8;
const STUCK_AFTER_MS = 10 * 60_000;

export type PayoutAccount = {
  payoutMethod: "tnm" | "airtel" | "bank" | null;
  payoutAccountName: string | null;
  payoutAccountNumber: string | null;
  payoutBankUuid: string | null;
};

/** True when the organiser has told us where to send their money. */
export function hasPayoutAccount(p: PayoutAccount): boolean {
  if (!p.payoutMethod || !p.payoutAccountNumber) return false;
  if (p.payoutMethod === "bank") return Boolean(p.payoutBankUuid && p.payoutAccountName);
  return normalizeMsisdn(p.payoutAccountNumber) !== null;
}

async function tierOf(eventId: number): Promise<EventTier> {
  const [event] = await db.select({ tier: events.tier }).from(events).where(eq(events.id, eventId)).limit(1);
  return event && isEventTier(event.tier) ? event.tier : "standard";
}

const METHOD_LABEL = { tnm: "TNM Mpamba", airtel: "Airtel Money", bank: "your bank account" } as const;

async function organiserEmail(profile: { email: string | null; userId: number }): Promise<string | null> {
  if (profile.email?.includes("@")) return profile.email;
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, profile.userId)).limit(1);
  return u?.email?.includes("@") ? u.email : null;
}

/** Emails the organiser once per payout that the money has been sent. Never throws; a failed email is retried on the next call. */
async function notifyPaid(row: Payout): Promise<void> {
  if (row.paidEmailAt || (row.status !== "sent" && row.status !== "paid")) return;
  const [claimed] = await db
    .update(payouts)
    .set({ paidEmailAt: new Date() })
    .where(and(eq(payouts.id, row.id), isNull(payouts.paidEmailAt)))
    .returning({ id: payouts.id });
  if (!claimed) return; // someone else is sending it
  try {
    const [profile] = await db.select().from(businessProfiles).where(eq(businessProfiles.id, row.businessProfileId)).limit(1);
    const [payment] = await db.select({ metadata: payments.metadata, reference: payments.reference }).from(payments).where(eq(payments.id, row.paymentId)).limit(1);
    const to = profile ? await organiserEmail(profile) : null;
    if (!profile || !payment || !to) return; // nobody to email; leave it marked so we do not retry forever
    const intent = readIntent(payment.metadata);
    const method = profile.payoutMethod ?? "tnm";
    const tail = (profile.payoutAccountNumber ?? "").slice(-3);
    await sendPayoutSentEmail({
      to,
      businessName: profile.businessName,
      eventTitle: intent?.eventTitle ?? "your event",
      ticketSummary: intent ? `${intent.quantity} x ${intent.ticketName}` : "Ticket sale",
      gross: row.grossAmount,
      commissionRate: Number(row.commissionRate),
      commission: row.commissionAmount,
      net: row.netAmount,
      destination: `${METHOD_LABEL[method]}${tail ? ` ending ${tail}` : ""}`,
      reference: payment.reference,
    });
  } catch (err) {
    console.error("Payout email failed (will retry):", err);
    await db.update(payouts).set({ paidEmailAt: null }).where(eq(payouts.id, row.id));
  }
}

/** Emails the organiser (at most once a day) that a sale is waiting because they have no payout account. */
async function notifyDetailsNeeded(row: Payout): Promise<void> {
  if (row.detailsEmailAt) return;
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const [recent] = await db
    .select({ id: payouts.id })
    .from(payouts)
    .where(and(eq(payouts.businessProfileId, row.businessProfileId), gt(payouts.detailsEmailAt, dayAgo)))
    .limit(1);
  if (recent) return;
  const [claimed] = await db
    .update(payouts)
    .set({ detailsEmailAt: new Date() })
    .where(and(eq(payouts.id, row.id), isNull(payouts.detailsEmailAt)))
    .returning({ id: payouts.id });
  if (!claimed) return;
  try {
    const [profile] = await db.select().from(businessProfiles).where(eq(businessProfiles.id, row.businessProfileId)).limit(1);
    const [payment] = await db.select({ metadata: payments.metadata }).from(payments).where(eq(payments.id, row.paymentId)).limit(1);
    const to = profile ? await organiserEmail(profile) : null;
    if (!profile || !to) return;
    await sendPayoutDetailsNeededEmail({
      to,
      businessName: profile.businessName,
      eventTitle: readIntent(payment?.metadata)?.eventTitle ?? "your event",
      net: row.netAmount,
    });
  } catch (err) {
    console.error("Payout-details email failed:", err);
    await db.update(payouts).set({ detailsEmailAt: null }).where(eq(payouts.id, row.id));
  }
}

/**
 * Pays the organiser for one ticket purchase. Idempotent and safe to call from the webhook, the
 * buyer's status poll and the admin retry: it does nothing if the payout was already sent.
 * Never throws; a failure is stored on the payout row and retried later.
 */
export async function sendOrganiserPayout(paymentId: number): Promise<Payout | null> {
  try {
    const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!payment || payment.status !== "succeeded") return null;
    const intent = readIntent(payment.metadata);
    if (!intent) return null; // bus seats and publishing fees are not event payouts

    // Only pay out for tickets that were actually issued (not for "sold out, refund needed").
    const [booking] = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.paymentId, payment.id)).limit(1);
    if (!booking) return null;

    const tier = await tierOf(intent.eventId);
    const split = splitTicketAmount(payment.amount, tier);
    await db
      .insert(payouts)
      .values({
        paymentId: payment.id,
        businessProfileId: payment.businessProfileId,
        eventId: intent.eventId,
        tier,
        grossAmount: payment.amount,
        commissionRate: split.rate.toFixed(2),
        commissionAmount: split.commission,
        netAmount: split.net,
        currency: payment.currency,
        status: "pending",
        chargeId: `PO${payment.reference}`.slice(0, 100),
      })
      .onConflictDoNothing();

    const [row] = await db.select().from(payouts).where(eq(payouts.paymentId, payment.id)).limit(1);
    if (!row) return null;
    if (row.status === "sent" || row.status === "paid") {
      await notifyPaid(row); // no-op if the organiser was already emailed
      return row;
    }
    if (row.attempts >= MAX_ATTEMPTS) return row;

    const [profile] = await db.select().from(businessProfiles).where(eq(businessProfiles.id, row.businessProfileId)).limit(1);
    if (!profile || !hasPayoutAccount(profile)) {
      const [updated] = await db
        .update(payouts)
        .set({ status: "needs-details", lastError: "The organiser has not added a payout account yet", updatedAt: new Date() })
        .where(and(eq(payouts.id, row.id), inArray(payouts.status, ["pending", "needs-details", "failed"])))
        .returning();
      if (updated) await notifyDetailsNeeded(updated);
      return updated ?? row;
    }
    if (row.netAmount <= 0) return row;

    // Claim the row so two concurrent calls cannot both send. A row stuck in "sending" (crashed
    // mid-call) may be claimed again after a while: the unchanged charge_id keeps that safe.
    const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS);
    const [claimed] = await db
      .update(payouts)
      .set({ status: "sending", attempts: row.attempts + 1, updatedAt: new Date() })
      .where(
        and(
          eq(payouts.id, row.id),
          or(inArray(payouts.status, ["pending", "needs-details", "failed"]), and(eq(payouts.status, "sending"), lt(payouts.updatedAt, stuckBefore))),
        ),
      )
      .returning();
    if (!claimed) return row;

    try {
      if (profile.payoutMethod === "bank") {
        await sendBankPayout({
          chargeId: claimed.chargeId,
          bankUuid: profile.payoutBankUuid!,
          accountName: profile.payoutAccountName!,
          accountNumber: profile.payoutAccountNumber!,
          amount: claimed.netAmount,
          email: profile.email,
        });
      } else {
        const method = profile.payoutMethod as "tnm" | "airtel";
        const operatorRefId = await operatorRefFor(method);
        if (!operatorRefId) throw new Error(`PayChangu mobile money operator for ${method} not found`);
        await sendMobileMoneyPayout({
          chargeId: claimed.chargeId,
          mobile: normalizeMsisdn(profile.payoutAccountNumber)!,
          operatorRefId,
          amount: claimed.netAmount,
          name: profile.payoutAccountName ?? profile.businessName,
          email: profile.email,
        });
      }
      const [sent] = await db
        .update(payouts)
        .set({ status: "sent", sentAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(payouts.id, claimed.id))
        .returning();
      await createAuditLog({
        actorUserId: null,
        businessProfileId: claimed.businessProfileId,
        action: "success",
        resourceType: "payout",
        resourceId: claimed.id,
        details: { paymentId: payment.id, gross: claimed.grossAmount, commission: claimed.commissionAmount, net: claimed.netAmount, tier },
      }).catch(() => undefined);
      if (sent) await notifyPaid(sent);
      return sent;
    } catch (err) {
      const message = err instanceof PaychanguError ? (paychanguErrorDetail(err.body) ?? err.message) : err instanceof Error ? err.message : String(err);
      console.error("Organiser payout failed:", { paymentId: payment.id, message });
      const [failed] = await db
        .update(payouts)
        .set({ status: "failed", lastError: message.slice(0, 500), updatedAt: new Date() })
        .where(eq(payouts.id, claimed.id))
        .returning();
      return failed ?? claimed;
    }
  } catch (err) {
    console.error("sendOrganiserPayout error:", err);
    return null;
  }
}

/** Asks PayChangu whether a "sent" payout has landed (or bounced) and updates the row. */
export async function refreshPayoutStatus(row: Payout): Promise<Payout> {
  if (row.status !== "sent") return row;
  const [profile] = await db.select({ method: businessProfiles.payoutMethod }).from(businessProfiles).where(eq(businessProfiles.id, row.businessProfileId)).limit(1);
  try {
    const state = await getPayoutState(row.chargeId, profile?.method === "bank" ? "bank" : "mobile");
    if (state === "paid") {
      const [u] = await db.update(payouts).set({ status: "paid", updatedAt: new Date() }).where(eq(payouts.id, row.id)).returning();
      return u ?? row;
    }
    if (state === "failed") {
      const [u] = await db
        .update(payouts)
        .set({ status: "failed", lastError: "PayChangu reported the payout as failed", updatedAt: new Date() })
        .where(eq(payouts.id, row.id))
        .returning();
      return u ?? row;
    }
  } catch (err) {
    console.error("Payout status check failed:", err);
  }
  return row;
}

/** Retries every payout that is waiting on the organiser's details or that failed. Used by the admin route / a cron. */
export async function retryOpenPayouts(): Promise<{ attempted: number; sent: number }> {
  const open = await db
    .select({ paymentId: payouts.paymentId })
    .from(payouts)
    .where(inArray(payouts.status, ["pending", "needs-details", "failed", "sending"]))
    .limit(100);
  let sent = 0;
  for (const o of open) {
    const r = await sendOrganiserPayout(o.paymentId);
    if (r && (r.status === "sent" || r.status === "paid")) sent++;
  }
  return { attempted: open.length, sent };
}
