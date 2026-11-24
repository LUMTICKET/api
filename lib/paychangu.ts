// PayChangu (https://developer.paychangu.com) - the ONLY payment provider for Lumticket.
// TNM Mpamba, Airtel Money and bank cards.
//
//   POST {base}/payment                                  -> { data: { checkout_url } }  hosted page (Bearer secret key)
//   GET  {base}/verify-payment/{tx_ref}                  -> { status, data: { status, amount, currency } }
//   GET  {base}/mobile-money                             -> operators (ids needed for a direct charge)
//   POST {base}/mobile-money/payments/initialize         -> PIN prompt on the payer's phone
//   GET  {base}/mobile-money/payments/{charge_id}/verify -> status of that direct charge
//   Webhook: header `Signature` = HMAC-SHA256(raw body, webhook secret), hex.
//
// A payment only becomes "succeeded" after the SERVER verifies it with PayChangu itself, so a
// spoofed webhook or a tampered redirect can never mark a payment as paid.
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments } from "@/drizzle/schema";
import { createAuditLog } from "@/lib/audit";
import { fulfilTicketPurchase } from "@/lib/purchase";

export const PAYMENT_PROVIDER = "paychangu" as const;
export type PaymentProvider = typeof PAYMENT_PROVIDER;

export class PaychanguError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
    this.name = "PaychanguError";
  }
}

export function paychanguErrorDetail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { message?: unknown; errors?: unknown };
  if (typeof b.message === "string" && b.message) return b.message;
  if (b.errors && typeof b.errors === "object") return JSON.stringify(b.errors);
  return null;
}

const baseUrl = () => (process.env.PAYCHANGU_BASE_URL || "https://api.paychangu.com").replace(/\/$/, "");

function secretKey() {
  const key = process.env.PAYCHANGU_SECRET_KEY?.trim();
  if (!key) throw new Error("Missing env var: PAYCHANGU_SECRET_KEY");
  return key;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${secretKey()}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new PaychanguError(`PayChangu ${path} failed`, res.status, body);
  return body as T;
}

// ---- Helpers ---------------------------------------------------------------------------------

/**
 * Malawian mobile money number in the local format PayChangu expects (0999123456 / 0888123456).
 * Accepts 0999123456, 999123456, 265999123456, +265 999 123 456, 00265999123456. Null if it can't be one.
 */
export function normalizeMsisdn(phone: unknown): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (/^265[89]\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^0[89]\d{8}$/.test(digits)) return digits;
  if (/^[89]\d{8}$/.test(digits)) return `0${digits}`;
  return null;
}

/** PayChangu sends amounts as numbers or formatted strings ("10,000.00"). Null when unreadable. */
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[^0-9.\-]/g, ""));
  return value.trim() && Number.isFinite(n) ? n : null;
}

/** PayChangu reports Malawi kwacha as "MWK" on hosted checkout and "MK" on direct charges. */
export function normalizeCurrency(value: unknown): string | null {
  const c = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!c) return null;
  return c === "MK" || c === "MWK" || c === "KWACHA" ? "MWK" : c;
}

/** Where a payer lands after the secure page: buyers -> the ticket site, business owners -> the business site. */
export type Audience = "buyer" | "business";
export function returnUrlFor(audience: Audience) {
  const clean = (v: string | undefined, fallback: string) => (v?.trim() || fallback).replace(/\/$/, "");
  const path = (v: string | undefined, fallback: string) => {
    const p = v === undefined ? fallback : v.trim();
    return p && !p.startsWith("/") ? `/${p}` : p;
  };
  if (audience === "buyer") {
    return `${clean(process.env.BUYER_SITE_URL, "https://lumticket.com")}${path(process.env.BUYER_RETURN_PATH, "/tickets")}`;
  }
  return `${clean(process.env.BUSINESS_SITE_URL, "https://business.lumticket.com")}${path(process.env.BUSINESS_RETURN_PATH, "")}`;
}

function splitName(name?: string | null) {
  const [first, ...rest] = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { first, last: rest.join(" ") };
}

// ---- Hosted checkout (cards, and mobile money on PayChangu's own page) -----------------------

/** Creates a hosted checkout session; send the customer to `checkoutUrl` to pay by mobile money or card. */
export async function initiateCheckout(input: {
  txRef: string; // unique per payment
  amount: number; // whole MWK
  title: string;
  description: string;
  email?: string | null;
  name?: string | null;
  audience?: Audience;
}): Promise<{ checkoutUrl: string }> {
  const { first, last } = splitName(input.name);
  const url = returnUrlFor(input.audience ?? "buyer");
  const body = {
    amount: input.amount,
    currency: "MWK",
    tx_ref: input.txRef,
    callback_url: process.env.PAYCHANGU_CALLBACK_URL?.trim() || url,
    return_url: url,
    ...(input.email ? { email: input.email } : {}),
    ...(first ? { first_name: first } : {}),
    ...(last ? { last_name: last } : {}),
    customization: { title: input.title.slice(0, 60), description: input.description.slice(0, 200) },
    meta: { source: "lumticket" },
  };
  const r = await call<{ data?: { checkout_url?: string } }>("/payment", { method: "POST", body: JSON.stringify(body) });
  const checkoutUrl = r?.data?.checkout_url;
  if (!checkoutUrl) throw new PaychanguError("PayChangu returned no checkout_url", 502, r);
  return { checkoutUrl };
}

export type Verification = { status: string; amount: number | null; currency: string | null };

type VerifyBody = {
  status?: string;
  data?: Record<string, unknown> & { transaction?: Record<string, unknown> };
};

/** Asks PayChangu directly. Returns null while the transaction is unknown (e.g. customer hasn't paid yet). */
export async function verifyPayment(txRef: string): Promise<Verification | null> {
  try {
    const r = await call<VerifyBody>(`/verify-payment/${encodeURIComponent(txRef)}`);
    const d = r?.data;
    // Only the transaction's own status counts: the top-level `status` just says the lookup worked.
    if (!d || typeof d.status !== "string") return null;
    return { status: d.status, amount: parseAmount(d.amount), currency: normalizeCurrency(d.currency) };
  } catch (err) {
    if (err instanceof PaychanguError && err.status >= 400 && err.status < 500) return null;
    throw err;
  }
}

// ---- Direct mobile money (our own checkout UI: PIN prompt goes to the payer's phone) ---------

export type Operator = { name: string; refId: string };
let operatorCache: { at: number; ops: Operator[]; error?: unknown } | null = null;

/** Supported mobile money operators. Cached briefly; failures are cached for a minute (and rethrown) so a bad key isn't hammered. */
export async function listMobileMoneyOperators(): Promise<Operator[]> {
  if (operatorCache && Date.now() - operatorCache.at < (operatorCache.ops.length ? 10 * 60_000 : 60_000)) {
    if (operatorCache.error) throw operatorCache.error;
    return operatorCache.ops;
  }
  try {
    const r = await call<unknown>("/mobile-money");
    const rows = Array.isArray(r) ? r : Array.isArray((r as { data?: unknown })?.data) ? (r as { data: unknown[] }).data : [];
    const ops = rows
      .map((o) => {
        const row = o as { name?: unknown; ref_id?: unknown; refId?: unknown };
        return { name: String(row.name ?? ""), refId: String(row.ref_id ?? row.refId ?? "") };
      })
      .filter((o) => o.name && o.refId);
    operatorCache = { at: Date.now(), ops };
    return ops;
  } catch (error) {
    operatorCache = { at: Date.now(), ops: [], error };
    throw error;
  }
}

/** Operator id for tnm | airtel: env override first (PAYCHANGU_OPERATOR_TNM / _AIRTEL), else matched by name. */
export async function operatorRefFor(method: "tnm" | "airtel"): Promise<string | null> {
  const override = process.env[method === "tnm" ? "PAYCHANGU_OPERATOR_TNM" : "PAYCHANGU_OPERATOR_AIRTEL"]?.trim();
  if (override) return override;
  try {
    const ops = await listMobileMoneyOperators();
    const match = ops.find((o) => (method === "airtel" ? /airtel/i : /tnm|mpamba/i).test(o.name));
    return match?.refId ?? null;
  } catch (err) {
    console.error("PayChangu operators lookup failed:", err);
    return null;
  }
}

/** True when both TNM and Airtel can be charged directly, i.e. the apps can use their own payment screen. */
export async function mobileMoneyAvailable(): Promise<boolean> {
  if (!process.env.PAYCHANGU_SECRET_KEY) return false;
  const [tnm, airtel] = await Promise.all([operatorRefFor("tnm"), operatorRefFor("airtel")]);
  return Boolean(tnm && airtel);
}

/** Sends the PIN prompt to `mobile`. The charge settles later; confirm with verifyMobileCharge. */
export async function chargeMobileMoney(input: {
  chargeId: string; // unique per payment
  mobile: string;
  operatorRefId: string;
  amount: number;
  email?: string | null;
  name?: string | null;
}) {
  const { first, last } = splitName(input.name);
  const r = await call<{ status?: string; message?: string; data?: Record<string, unknown> }>("/mobile-money/payments/initialize", {
    method: "POST",
    body: JSON.stringify({
      mobile: input.mobile,
      mobile_money_operator_ref_id: input.operatorRefId,
      amount: String(input.amount),
      charge_id: input.chargeId,
      ...(input.email ? { email: input.email } : {}),
      ...(first ? { first_name: first } : {}),
      ...(last ? { last_name: last } : {}),
    }),
  });
  // A 200 whose body says the charge could not be started must not leave the buyer waiting for a prompt.
  if (typeof r?.status === "string" && FAILURE.has(r.status.toLowerCase())) {
    throw new PaychanguError(r.message || "PayChangu could not send the payment prompt", 400, r);
  }
  return r;
}

/** GET /mobile-money/payments/{chargeId}/verify. Null while PayChangu doesn't know the charge yet. */
export async function verifyMobileCharge(chargeId: string): Promise<Verification | null> {
  try {
    const r = await call<VerifyBody>(`/mobile-money/payments/${encodeURIComponent(chargeId)}/verify`);
    const d = r?.data?.transaction ?? r?.data;
    if (!d) return null;
    const topLevel = typeof r.status === "string" ? r.status : "";
    let status = typeof d.status === "string" ? d.status : topLevel;
    // Direct-charge verifies report the outcome in the top-level `status` and carry no data.status.
    // A bare "success" there only proves the lookup worked, so count it as paid only once the
    // charge shows a completion time.
    if (typeof d.status !== "string" && SUCCESS.has(status.toLowerCase()) && !d.completed_at) status = "pending";
    return { status: String(status), amount: parseAmount(d.amount), currency: normalizeCurrency(d.currency) ?? "MWK" };
  } catch (err) {
    if (err instanceof PaychanguError && err.status >= 400 && err.status < 500) return null;
    throw err;
  }
}

// ---- Payouts (money OUT of Lumticket's PayChangu account to an organiser) ----------------------
//   POST {base}/mobile-money/payouts/initialize        TNM / Airtel wallet
//   POST {base}/direct-charge/payouts/initialize       bank account
//   GET  {base}/mobile-money/payments/{charge_id}      status of a mobile money payout
//   GET  {base}/direct-charge/payouts/{charge_id}/details   status of a bank payout
// charge_id must be unique per payout: re-sending the same one cannot pay twice.

export async function sendMobileMoneyPayout(input: {
  chargeId: string;
  mobile: string;
  operatorRefId: string;
  amount: number;
  name?: string | null;
  email?: string | null;
}) {
  const { first, last } = splitName(input.name);
  const r = await call<{ status?: string; message?: string }>("/mobile-money/payouts/initialize", {
    method: "POST",
    body: JSON.stringify({
      mobile: input.mobile,
      mobile_money_operator_ref_id: input.operatorRefId,
      amount: String(input.amount),
      charge_id: input.chargeId,
      ...(input.email ? { email: input.email } : {}),
      ...(first ? { first_name: first } : {}),
      ...(last ? { last_name: last } : {}),
    }),
  });
  if (typeof r?.status === "string" && FAILURE.has(r.status.toLowerCase())) {
    throw new PaychanguError(r.message || "PayChangu rejected the payout", 400, r);
  }
  return r;
}

export async function sendBankPayout(input: {
  chargeId: string;
  bankUuid: string;
  accountName: string;
  accountNumber: string;
  amount: number;
  email?: string | null;
}) {
  const { first, last } = splitName(input.accountName);
  const r = await call<{ status?: string; message?: string }>("/direct-charge/payouts/initialize", {
    method: "POST",
    body: JSON.stringify({
      payout_method: "bank_transfer",
      bank_uuid: input.bankUuid,
      amount: String(input.amount),
      charge_id: input.chargeId,
      bank_account_name: input.accountName,
      bank_account_number: input.accountNumber,
      ...(input.email ? { email: input.email } : {}),
      ...(first ? { first_name: first } : {}),
      ...(last ? { last_name: last } : {}),
    }),
  });
  if (typeof r?.status === "string" && FAILURE.has(r.status.toLowerCase())) {
    throw new PaychanguError(r.message || "PayChangu rejected the payout", 400, r);
  }
  return r;
}

/** Final state of a payout as PayChangu reports it, or null while unknown. */
export async function getPayoutState(chargeId: string, kind: "mobile" | "bank"): Promise<"paid" | "failed" | "pending" | null> {
  const path = kind === "mobile" ? `/mobile-money/payments/${encodeURIComponent(chargeId)}` : `/direct-charge/payouts/${encodeURIComponent(chargeId)}/details`;
  try {
    const r = await call<VerifyBody>(path);
    const d = r?.data?.transaction ?? r?.data;
    const raw = (typeof d?.status === "string" ? d.status : typeof r?.status === "string" ? r.status : "").toLowerCase();
    if (SUCCESS.has(raw)) return "paid";
    if (FAILURE.has(raw)) return "failed";
    return raw ? "pending" : null;
  } catch (err) {
    if (err instanceof PaychanguError && err.status >= 400 && err.status < 500) return null;
    throw err;
  }
}

/** Banks PayChangu can pay out to (for bank payouts). Tolerates uuid/id and name/bank_name field names. */
export async function listSupportedBanks(): Promise<{ uuid: string; name: string }[]> {
  const r = await call<unknown>("/direct-charge/payouts/supported-banks?currency=MWK");
  const rows = Array.isArray(r) ? r : Array.isArray((r as { data?: unknown })?.data) ? (r as { data: unknown[] }).data : [];
  return rows
    .map((b) => {
      const row = b as Record<string, unknown>;
      return { uuid: String(row.uuid ?? row.id ?? ""), name: String(row.name ?? row.bank_name ?? "") };
    })
    .filter((b) => b.uuid && b.name);
}

export type StartedPayment = { checkoutUrl?: string };

/**
 * Starts a PayChangu payment for an already-inserted `payments` row, shared by ticket purchases and the
 * business publishing fee so both use the same flow:
 *   tnm/airtel + phone -> PIN prompt on the phone (own checkout UI)
 *   card (or mobile money not available) -> PayChangu's secure hosted page, `checkoutUrl` returned
 */
export async function startPaychanguPayment(input: {
  paymentId: number;
  reference: string;
  method: "tnm" | "airtel" | "card";
  phone: string | null;
  amount: number;
  title: string;
  description: string;
  email?: string | null;
  name?: string | null;
  /** Kept in payments.metadata (e.g. the ticket purchase intent). */
  baseMetadata?: Record<string, unknown>;
  audience?: Audience;
}): Promise<StartedPayment> {
  const base = input.baseMetadata ?? {};
  const save = (extra: Record<string, unknown>) =>
    db.update(payments).set({ metadata: { ...base, ...extra }, updatedAt: new Date() }).where(eq(payments.id, input.paymentId));

  if (input.method !== "card" && input.phone) {
    const operatorRefId = await operatorRefFor(input.method);
    if (operatorRefId) {
      await chargeMobileMoney({
        chargeId: input.reference,
        mobile: input.phone,
        operatorRefId,
        amount: input.amount,
        email: input.email,
        name: input.name,
      });
      await save({ flow: "mobile-money", operator: input.method });
      return {};
    }
  }

  const r = await initiateCheckout({
    txRef: input.reference,
    amount: input.amount,
    title: input.title,
    description: input.description,
    email: input.email,
    name: input.name,
    audience: input.audience,
  });
  await save({ flow: "hosted" });
  return { checkoutUrl: r.checkoutUrl };
}

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PAYCHANGU_WEBHOOK_SECRET?.trim() || process.env.PAYCHANGU_SECRET_KEY?.trim();
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Setup check: which settings are present (never their values). */
export function paychanguConfigStatus() {
  const missing = ["PAYCHANGU_SECRET_KEY"].filter((k) => !process.env[k]);
  const key = process.env.PAYCHANGU_SECRET_KEY ?? "";
  return {
    provider: PAYMENT_PROVIDER,
    ready: missing.length === 0,
    missing,
    mode: key.startsWith("sec-test") ? "test" : key ? "live" : "unknown",
    webhookSecretSet: Boolean(process.env.PAYCHANGU_WEBHOOK_SECRET),
    returnUrls: { buyer: returnUrlFor("buyer"), business: returnUrlFor("business") },
  };
}

/** Setup check that also asks PayChangu for its operators, so their ids can be copied if needed. */
export async function paychanguDiagnostics() {
  const base = paychanguConfigStatus();
  if (!base.ready) return { ...base, mobileMoneyDirect: false };
  try {
    const operators = await listMobileMoneyOperators();
    const [tnm, airtel] = await Promise.all([operatorRefFor("tnm"), operatorRefFor("airtel")]);
    return { ...base, operators, tnmOperatorFound: Boolean(tnm), airtelOperatorFound: Boolean(airtel), mobileMoneyDirect: Boolean(tnm && airtel) };
  } catch (err) {
    return { ...base, mobileMoneyDirect: false, operatorsError: err instanceof PaychanguError ? paychanguErrorDetail(err.body) ?? err.message : String(err) };
  }
}

const SUCCESS = new Set(["success", "successful", "succeeded", "paid", "completed"]);
const FAILURE = new Set(["failed", "failure", "cancelled", "canceled", "declined", "expired", "refunded", "reversed", "rejected"]);

/**
 * Brings one pending PayChangu payment up to date by verifying it with PayChangu, then issues the
 * ticket if it is a ticket purchase. Safe to call repeatedly (status poll, webhook, or both).
 */
export async function settlePaychanguPayment(paymentId: number): Promise<void> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment || payment.provider !== PAYMENT_PROVIDER) return;

  if (payment.status === "pending") {
    const flow = (payment.metadata as Record<string, unknown> | null)?.flow;
    let v: Verification | null;
    try {
      v = flow === "mobile-money" ? await verifyMobileCharge(payment.reference) : await verifyPayment(payment.reference);
    } catch (err) {
      console.error("PayChangu verify error:", err);
      return;
    }
    if (!v) return;
    const state = v.status.toLowerCase();
    const meta = { ...((payment.metadata as Record<string, unknown>) ?? {}), verification: v };

    if (SUCCESS.has(state)) {
      // Never accept less than the price, or another currency. (An amount PayChangu doesn't report
      // can't be compared; the charge was created for exactly our price, so that case is let through.)
      const wrongCurrency = v.currency !== null && v.currency !== payment.currency.toUpperCase();
      const underpaid = v.amount !== null && v.amount < payment.amount;
      if (wrongCurrency || underpaid) {
        console.error("PayChangu amount/currency mismatch:", { expected: payment.amount, got: v });
        await db.update(payments).set({ metadata: { ...meta, mismatch: true }, updatedAt: new Date() }).where(eq(payments.id, payment.id));
        return;
      }
      const updated = await db
        .update(payments)
        .set({ status: "succeeded", paidAt: new Date(), metadata: meta, updatedAt: new Date() })
        .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")))
        .returning({ id: payments.id });
      if (updated.length) {
        await createAuditLog({
          actorUserId: null,
          businessProfileId: payment.businessProfileId,
          action: "success",
          resourceType: "payment",
          resourceId: payment.id,
          details: { provider: PAYMENT_PROVIDER, reference: payment.reference },
        });
      }
    } else if (FAILURE.has(state)) {
      await db
        .update(payments)
        .set({ status: "failed", metadata: meta, updatedAt: new Date() })
        .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
      return;
    } else {
      return; // still processing
    }
  }

  // Succeeded (now or earlier): make sure a ticket purchase has its booking.
  try {
    const result = await fulfilTicketPurchase(payment.id);
    // The ticket is issued: pay the organiser their share (Lumticket keeps its commission).
    // Imported lazily because lib/payouts.ts itself builds on this file.
    if (result.booking) {
      const { sendOrganiserPayout } = await import("@/lib/payouts");
      await sendOrganiserPayout(payment.id);
    }
  } catch (err) {
    console.error("Ticket fulfilment / payout error:", err);
  }
}
