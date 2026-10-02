import crypto from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { twoFactorChallenges, users } from "@/drizzle/schema";
import type { User } from "@/drizzle/schema";
import { sendTwoFactorEmail } from "@/lib/email";

/** Two-factor codes live for 10 minutes and allow 5 attempts. */
export const TWO_FACTOR_TTL_MS = 10 * 60 * 1000;
export const TWO_FACTOR_MAX_ATTEMPTS = 5;

const CODE_LENGTH = 6;
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-jwt-secret-change-me";

function hashCode(code: string) {
  return crypto
    .createHash("sha256")
    .update(`${JWT_SECRET}:${code}`)
    .digest("hex");
}

function generateCode() {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

function maskEmail(email: string) {
  const [local = "", domain = ""] = String(email).split("@");
  if (!domain) return "your email";
  const head = local.slice(0, 1) || "*";
  return `${head}${"*".repeat(Math.max(Math.min(local.length - 1, 3), 1))}@${domain}`;
}

export interface TwoFactorChallengeResult {
  challengeToken: string;
  channel: "email";
  delivery: "sent" | "failed";
  expiresIn: number;
  maskedDestination: string;
  /** Only returned outside production to make local testing possible. */
  devCode?: string;
}

async function issueEmailCode(user: User, existingToken?: string) {
  const code = generateCode();
  const token = existingToken ?? crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TWO_FACTOR_TTL_MS);

  if (existingToken) {
    await db
      .update(twoFactorChallenges)
      .set({ codeHash: hashCode(code), attempts: 0, expiresAt, updatedAt: new Date() })
      .where(eq(twoFactorChallenges.token, existingToken));
  } else {
    // Only one live challenge per account.
    await db
      .delete(twoFactorChallenges)
      .where(eq(twoFactorChallenges.userId, user.id));
    await db.insert(twoFactorChallenges).values({
      userId: user.id,
      token,
      codeHash: hashCode(code),
      channel: "email",
      attempts: 0,
      expiresAt,
    });
  }

  let delivery: "sent" | "failed" = "failed";
  try {
    await sendTwoFactorEmail({
      to: user.email,
      name: user.name,
      code,
      expiresInMinutes: Math.round(TWO_FACTOR_TTL_MS / 60000),
    });
    delivery = "sent";
  } catch (err) {
    console.error("Two-factor email delivery failed:", err);
  }

  const result: TwoFactorChallengeResult = {
    challengeToken: token,
    channel: "email",
    delivery,
    expiresIn: Math.round(TWO_FACTOR_TTL_MS / 1000),
    maskedDestination: maskEmail(user.email),
  };
  if (process.env.NODE_ENV !== "production") result.devCode = code;
  return result;
}

/**
 * Starts the second factor after a password login: stores a hashed 6-digit
 * code and emails it to the account address. Returns the challenge token the
 * client sends back to POST /api/auth/2fa.
 */
export function createTwoFactorChallenge(user: User) {
  return issueEmailCode(user);
}

/** Re-issues a fresh code for an existing, still-valid challenge. */
export async function resendTwoFactorChallenge(challengeToken: string) {
  const [challenge] = await db
    .select()
    .from(twoFactorChallenges)
    .where(
      and(
        eq(twoFactorChallenges.token, String(challengeToken ?? "")),
        isNull(twoFactorChallenges.consumedAt)
      )
    )
    .limit(1);

  if (!challenge || challenge.expiresAt < new Date()) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, challenge.userId))
    .limit(1);
  if (!user) return null;

  return issueEmailCode(user, challenge.token);
}

export type TwoFactorVerifyResult =
  | { ok: true; userId: number }
  | { ok: false; error: string; status: number };

/** Validates a 6-digit code against a pending challenge. */
export async function verifyTwoFactorChallenge(
  challengeToken: string,
  code: string
): Promise<TwoFactorVerifyResult> {
  const [challenge] = await db
    .select()
    .from(twoFactorChallenges)
    .where(eq(twoFactorChallenges.token, String(challengeToken ?? "")))
    .limit(1);

  if (!challenge || challenge.consumedAt) {
    return { ok: false, error: "Challenge not found or already used", status: 401 };
  }

  if (challenge.expiresAt < new Date()) {
    return { ok: false, error: "Code expired, start login again", status: 410 };
  }

  if (challenge.attempts >= TWO_FACTOR_MAX_ATTEMPTS) {
    await db
      .update(twoFactorChallenges)
      .set({ consumedAt: new Date(), updatedAt: new Date() })
      .where(eq(twoFactorChallenges.id, challenge.id));
    return { ok: false, error: "Too many attempts, start login again", status: 429 };
  }

  const submitted = String(code ?? "").trim();
  const expected = Buffer.from(challenge.codeHash, "hex");
  const actual = Buffer.from(
    hashCode(submitted.padStart(CODE_LENGTH, "0").slice(0, CODE_LENGTH)),
    "hex"
  );
  const shapeValid = new RegExp(`^\\d{${CODE_LENGTH}}$`).test(submitted);
  const valid =
    shapeValid &&
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual);

  if (!valid) {
    const attempts = challenge.attempts + 1;
    await db
      .update(twoFactorChallenges)
      .set({
        attempts,
        ...(attempts >= TWO_FACTOR_MAX_ATTEMPTS ? { consumedAt: new Date() } : {}),
        updatedAt: new Date(),
      })
      .where(eq(twoFactorChallenges.id, challenge.id));

    if (attempts >= TWO_FACTOR_MAX_ATTEMPTS) {
      return { ok: false, error: "Too many attempts, start login again", status: 429 };
    }
    return { ok: false, error: "Incorrect code", status: 401 };
  }

  await db
    .update(twoFactorChallenges)
    .set({ consumedAt: new Date(), updatedAt: new Date() })
    .where(eq(twoFactorChallenges.id, challenge.id));

  return { ok: true, userId: challenge.userId };
}
