import { NextRequest } from "next/server";
import { validateSessionToken } from "./auth";
import { db } from "./db";
import { users } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

export async function getCurrentUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) return null;

  try {
    const decoded = await validateSessionToken(token);
    if (!decoded) return null;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, decoded.userId))
      .limit(1);
    return user || null;
  } catch {
    return null;
  }
}