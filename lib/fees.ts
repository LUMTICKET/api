/** Fee a business pays (via PayChangu) to publish one listing. Set PUBLISHING_FEE_MWK to change it. */
export function publishingFeeMwk(): number {
  const n = Number(process.env.PUBLISHING_FEE_MWK);
  return Number.isInteger(n) && n > 0 ? n : 10000;
}

// ---- Platform commission on ticket sales -------------------------------------------------------
//
// Every ticket purchase is collected in full into Lumticket's PayChangu account. The commission below is
// paid BY the organiser TO Lumticket (the platform / system owners): Lumticket keeps it, and only the
// remainder is paid out to the organiser straight away (see lib/payouts.ts). It is platform income,
// never organiser income.
//
//   small    5%
//   standard 7%
//   premium  8%
//
// The tier is decided by the SERVER when the event is published (never by the client), from the
// event's size and its highest ticket price. All numbers can be changed with env variables.

export const EVENT_TIERS = ["small", "standard", "premium"] as const;
export type EventTier = (typeof EVENT_TIERS)[number];

const DEFAULT_RATES: Record<EventTier, number> = { small: 5, standard: 7, premium: 8 };

function envNumber(name: string, fallback: number, min = 0, max = Infinity): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** Commission percentage for a tier. Override with EVENT_COMMISSION_SMALL / _STANDARD / _PREMIUM. */
export function commissionRatePercent(tier: EventTier): number {
  return envNumber(`EVENT_COMMISSION_${tier.toUpperCase()}`, DEFAULT_RATES[tier], 0, 100);
}

/**
 * Which tier an event belongs to.
 *  premium  - its most expensive ticket costs at least PREMIUM_MIN_TICKET_PRICE_MWK (default 50 000)
 *  small    - otherwise, at most SMALL_EVENT_MAX_CAPACITY tickets in total (default 200)
 *  standard - everything else
 */
export function eventTierFor(input: { totalCapacity: number; maxTicketPrice: number }): EventTier {
  const premiumMin = envNumber("PREMIUM_MIN_TICKET_PRICE_MWK", 50_000, 1);
  const smallMax = envNumber("SMALL_EVENT_MAX_CAPACITY", 200, 1);
  if (input.maxTicketPrice >= premiumMin) return "premium";
  if (input.totalCapacity <= smallMax) return "small";
  return "standard";
}

export function isEventTier(v: unknown): v is EventTier {
  return typeof v === "string" && (EVENT_TIERS as readonly string[]).includes(v);
}

/** Splits a whole-MWK ticket amount into Lumticket's commission and the organiser's share. */
export function splitTicketAmount(amount: number, tier: EventTier) {
  const rate = commissionRatePercent(tier);
  const commission = Math.min(amount, Math.round((amount * rate) / 100));
  return { rate, commission, net: amount - commission };
}
