import crypto from "crypto";

/**
 * OneKhusa client (real API, no simulation).
 * Docs: https://docs.onekhusa.com
 *
 * Env:
 *   ONEKHUSA_BASE_URL            https://api.onekhusa.com/sandbox/v1  |  https://api.onekhusa.com/live/v1
 *   ONEKHUSA_API_KEY / ONEKHUSA_API_SECRET
 *   ONEKHUSA_ORGANISATION_ID
 *   ONEKHUSA_MERCHANT_ACCOUNT_NUMBER   (8 digits)
 *   ONEKHUSA_CONNECTOR_TNM / ONEKHUSA_CONNECTOR_AIRTEL   connector IDs from Get All Connectors
 *   ONEKHUSA_WEBHOOK_SECRET_SUCCESS / _FAILED / _REVERSED  one secret per event (Developers -> Webhooks)
 *   ONEKHUSA_CAPTURED_BY         email of the user initiating requests
 *   ONEKHUSA_SUCCESS_URL / ONEKHUSA_FAILURE_URL   hosted-checkout redirects
 */

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export class OneKhusaError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

/** The reason from a OneKhusa RFC 7807 error body, or null when there is none. */
export function errorDetail(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const { detail, errors, title } = body as { detail?: unknown; errors?: unknown; title?: unknown };
  if (Array.isArray(errors) && errors.length > 0) return errors.map(String).join("; ");
  if (typeof detail === "string" && detail) return detail;
  if (typeof title === "string" && title) return title;
  return null;
}

/** True when requests are going to the OneKhusa sandbox. */
export function isSandbox(): boolean {
  return (process.env.ONEKHUSA_BASE_URL ?? "").includes("/sandbox");
}

/**
 * The only payer wallets the OneKhusa sandbox accepts (see its "Test Accounts"
 * docs). Any other number is rejected with "… is not a correct test phone number".
 */
export const SANDBOX_TEST_WALLETS = { airtel: "221100000101", tnm: "231100000101" } as const;

export function sandboxWalletHint(method: "tnm" | "airtel"): string {
  const network = method === "tnm" ? "TNM Mpamba" : "Airtel Money";
  return `OneKhusa's sandbox only accepts its test ${network} wallet ${SANDBOX_TEST_WALLETS[method]} (PIN 1234). Every other number is rejected by the sandbox.`;
}

/**
 * Canonical payer MSISDN for OneKhusa push payments.
 *
 * OneKhusa documents the local Malawian format `0XXXXXXXXX`, but clients send
 * "+265991234567", "265991234567", "00991234567" or "991234567". Normalise all
 * of those to the same value and leave any other plausible wallet number (such
 * as OneKhusa's 12-digit sandbox test wallets) untouched. Returns null when the
 * value cannot be a mobile wallet number.
 */
export function normalizeMsisdn(phone: unknown): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  if (/^265[89]\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^0[89]\d{8}$/.test(digits)) return digits;
  if (/^[89]\d{8}$/.test(digits)) return `0${digits}`;
  return /^\d{9,12}$/.test(digits) ? digits : null;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

// Tokens live 5 minutes; refresh 30s early.
export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.value;

  const res = await fetch(`${env("ONEKHUSA_BASE_URL")}/account/getAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept-Language": "en" },
    body: JSON.stringify({
      apiKey: env("ONEKHUSA_API_KEY"),
      apiSecret: env("ONEKHUSA_API_SECRET"),
      organisationId: env("ONEKHUSA_ORGANISATION_ID"),
      merchantAccountNumber: Number(env("ONEKHUSA_MERCHANT_ACCOUNT_NUMBER")),
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.accessToken) throw new OneKhusaError("OneKhusa auth failed", res.status, body);

  cachedToken = {
    value: body.accessToken,
    expiresAt: body.expiresOn ? new Date(body.expiresOn).getTime() : Date.now() + (body.expiryInMinutes ?? 5) * 60_000,
  };
  return cachedToken.value;
}

async function post<T>(path: string, payload: unknown, idempotencyKey: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${env("ONEKHUSA_BASE_URL")}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept-Language": "en",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new OneKhusaError(`OneKhusa ${path} failed`, res.status, body);
  return body as T;
}

export type PushInitiateResponse = {
  merchantAccountNumber: number;
  sourceReferenceNumber: string;
  responseCode: string; // I100 = prompt dispatched
  feeRuleCode: string; // CC charge to customer, CM charge to merchant
  transactionAmount: number;
  totalCharges: number;
  amountToPay: number;
};

/** POST /collections/push/direct/initiate - USSD/STK prompt to TNM Mpamba or Airtel Money. */
export function initiateMobileMoneyPush(input: {
  connectorId: number;
  payerAccountNumber: string;
  sourceReferenceNumber: string; // 5-25 chars, unique per request
  description: string;
  amount: number;
}) {
  return post<PushInitiateResponse>(
    "/collections/push/direct/initiate",
    {
      merchantAccountNumber: Number(env("ONEKHUSA_MERCHANT_ACCOUNT_NUMBER")),
      connectorId: input.connectorId,
      // Always send the canonical local format, whatever the caller passed.
      payerAccountNumber: normalizeMsisdn(input.payerAccountNumber) ?? input.payerAccountNumber,
      sourceReferenceNumber: input.sourceReferenceNumber,
      transactionDescription: input.description,
      transactionAmount: input.amount,
      capturedBy: env("ONEKHUSA_CAPTURED_BY"),
    },
    input.sourceReferenceNumber
  );
}

export type CheckoutInitiateResponse = {
  sourceReferenceNumber: string;
  merchantAccountNumber: number;
  paymentTransactionId: string;
  checkoutUrl: string; // expires after 10 minutes
};

/** POST /checkout/push/initiate - hosted checkout (cards + mobile money). */
export function initiateHostedCheckout(input: {
  sourceReferenceNumber: string;
  description: string;
  amount: number;
}) {
  return post<CheckoutInitiateResponse>(
    "/checkout/push/initiate",
    {
      payment: {
        merchantAccountNumber: Number(env("ONEKHUSA_MERCHANT_ACCOUNT_NUMBER")),
        amount: input.amount,
        description: input.description,
        sourceReferenceNumber: input.sourceReferenceNumber,
        capturedBy: env("ONEKHUSA_CAPTURED_BY"),
      },
      route: {
        successRedirectionUrl: env("ONEKHUSA_SUCCESS_URL"),
        failureRedirectionUrl: env("ONEKHUSA_FAILURE_URL"),
      },
    },
    input.sourceReferenceNumber
  );
}

export function connectorIdFor(method: "tnm" | "airtel"): number {
  return Number(env(method === "tnm" ? "ONEKHUSA_CONNECTOR_TNM" : "ONEKHUSA_CONNECTOR_AIRTEL"));
}

export const WEBHOOK_EVENTS = ["pushpayment.success", "pushpayment.failed", "pushpayment.reversed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

function webhookSecret(event: WebhookEvent): string | undefined {
  return process.env[`ONEKHUSA_WEBHOOK_SECRET_${event.split(".")[1].toUpperCase()}`];
}

/** HMAC-SHA512 over the RAW body using the event-specific secret, constant-time compare. */
export function verifyWebhook(rawBody: string, event: string | null, signature: string | null): event is WebhookEvent {
  if (!rawBody || !event || !signature) return false;
  if (!(WEBHOOK_EVENTS as readonly string[]).includes(event)) return false;
  const secret = webhookSecret(event as WebhookEvent);
  if (!secret) return false;
  const computed = Buffer.from(crypto.createHmac("sha512", secret).update(rawBody, "utf8").digest("hex"), "utf8");
  const given = Buffer.from(signature.toLowerCase(), "utf8");
  return computed.length === given.length && crypto.timingSafeEqual(computed, given);
}
