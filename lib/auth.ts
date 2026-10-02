import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { eq, or, sql } from "drizzle-orm";
import { getSession, createSession } from "@/lib/session";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-jwt-secret-change-me";
const SALT_ROUNDS = 12;

if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET is not set; using a development fallback.");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: object) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

export function verifyToken(token: string) {
  return jwt.verify(token, JWT_SECRET) as {
    userId: number;
    email: string;
    sessionId?: string;
  };
}

export async function validateSessionToken(token: string) {
  const decoded = verifyToken(token);
  const session = await getSession(decoded.sessionId);

  if (!session) return null;
  if (session.userId !== decoded.userId || session.email !== decoded.email) {
    return null;
  }

  return decoded;
}

export async function getUserByEmail(email: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizeEmail(email)}`)
    .limit(1);
  return user ?? null;
}

/* ── Credential validation helpers ── */

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

/** Lowercases and trims an email address. */
export function normalizeEmail(email: unknown): string {
  return String(email ?? "").trim().toLowerCase();
}

/** True when the value is a structurally valid email address. */
export function isValidEmail(email: unknown): boolean {
  const value = normalizeEmail(email);
  return value.length <= 255 && EMAIL_PATTERN.test(value);
}

/** Strips formatting from a phone number, keeping a leading +. */
export function normalizePhone(phone: unknown): string {
  const raw = String(phone ?? "").replace(/[\s()-]/g, "").trim();
  return raw;
}

/** True when the value is a plausible international phone number. */
export function isValidPhone(phone: unknown): boolean {
  return PHONE_PATTERN.test(normalizePhone(phone));
}

/** Minimum length for any newly created login credential. */
export const MIN_PASSWORD_LENGTH = 8;

export function isStrongEnoughPassword(password: unknown): boolean {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

/**
 * Resolves a login identifier to a user account. Accepts an email address,
 * a phone number, or the unique per-account Business ID (e.g. LMT-8F3K2QZ4).
 * Matching is case-insensitive and ignores formatting in phone numbers.
 */
export async function findUserByIdentifier(identifier: string) {
  const raw = String(identifier ?? "").trim();
  if (!raw) return null;

  const email = normalizeEmail(raw);
  const phone = normalizePhone(raw);
  const businessId = raw.toUpperCase();

  const conditions = [
    sql`lower(${users.email}) = ${email}`,
    sql`upper(${users.businessId}) = ${businessId}`,
  ];
  if (PHONE_PATTERN.test(phone)) {
    // Stored and submitted numbers match with or without a leading +.
    const digits = phone.replace(/^\+/, "");
    conditions.push(
      sql`ltrim(replace(replace(replace(${users.phone}, ' ', ''), '-', ''), '(', ''), '+') = ${digits}`
    );
  }

  const [user] = await db
    .select()
    .from(users)
    .where(or(...conditions))
    .limit(1);
  return user ?? null;
}

export async function getUserById(id: number) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return user ?? null;
}

/**
 * Creates a database-backed session plus signed access token for a user and
 * returns the token payload shared by every login/signup response.
 */
export async function startSessionForUser(
  user: { id: number; email: string },
  req: { headers: Headers }
) {
  const session = await createSession(user.id, user.email, {
    userAgent: req.headers.get("user-agent"),
    ipAddress: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
  });
  const token = signToken({
    userId: user.id,
    email: user.email,
    sessionId: session.sessionId,
  });

  return {
    token,
    refreshToken: session.refreshToken,
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    refreshExpiresAt: session.refreshExpiresAt,
  };
}
