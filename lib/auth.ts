import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/session";

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
    .where(eq(users.email, email))
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