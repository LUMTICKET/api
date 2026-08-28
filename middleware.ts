import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const allowedOrigins = [
  "https://psychic-dollop-97qjjq9wrrqx394x9-8081.app.github.dev",
  "https://lumticket.vercel.app",
  "https://api-phi-dun-27.vercel.app",
  "http://localhost:8081",
  "http://localhost:19006",
];

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "";
  const isAllowed =
    allowedOrigins.includes(origin) || origin.startsWith("https://localhost");

  // Preflight
  if (req.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    res.headers.set("Access-Control-Allow-Origin", isAllowed ? origin : "*");
    res.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, PATCH, OPTIONS"
    );
    res.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With"
    );
    res.headers.set("Access-Control-Max-Age", "86400");
    return res;
  }

  // Actual request
  const res = NextResponse.next();
  if (isAllowed) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Credentials", "true");
    res.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With"
    );
  }
  return res;
}

export const config = {
  matcher: "/api/:path*",
};