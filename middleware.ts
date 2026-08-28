import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const allowedOrigins = [
  "http://localhost:8081", // Expo dev
  "https://lumticket.vercel.app", // Production
  "https://api-phi-dun-27.vercel.app",
];

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin") ?? "";
  const isAllowed = allowedOrigins.includes(origin);

  // Handle preflight
  if (req.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    if (isAllowed) {
      res.headers.set("Access-Control-Allow-Origin", origin);
      res.headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
      );
    }
    return res;
  }

  const res = NextResponse.next();
  if (isAllowed) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Credentials", "true");
  }
  return res;
}

export const config = {
  matcher: "/api/:path*",
};