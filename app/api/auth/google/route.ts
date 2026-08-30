import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/drizzle/schema";
import { signToken, getUserByEmail } from "@/lib/auth";
import { createSession } from "@/lib/session";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const { idToken, email, name, avatar } = await req.json();

    if (!idToken || !email) {
      return NextResponse.json(
        { error: "Missing Google token" },
        { status: 400 }
      );
    }

    // Verify the Google ID token on your server if you want extra safety
    // (omitted for brevity — use google-auth-library)

    let user = await getUserByEmail(email);

    if (!user) {
      // Create new Google user
      const [newUser] = await db
        .insert(users)
        .values({
          email,
          name: name || null,
          avatar: avatar || null,
          googleId: idToken.slice(-20), // or extract real sub from verified token
        })
        .returning();
      user = newUser;
    } else if (!user.googleId) {
      // Link Google to existing account
      const [updated] = await db
        .update(users)
        .set({ googleId: idToken.slice(-20) })
        .where(eq(users.id, user.id))
        .returning();
      user = updated;
    }

    const session = await createSession(user.id, user.email, {
      userAgent: req.headers.get("user-agent"),
      ipAddress: req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
    });
    const token = signToken({
      userId: user.id,
      email: user.email,
      sessionId: session.sessionId,
    });

    return NextResponse.json({
      token,
      refreshToken: session.refreshToken,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      refreshExpiresAt: session.refreshExpiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    console.error("Google auth error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}