import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/drizzle/schema";
import { decodeDataUrl, isDataUrl } from "@/lib/poster";

interface Params { params: Promise<{ id: string }> }

/**
 * GET /api/events/:id/poster — public. Streams the poster/flyer image for a
 * published event so the ticket website and apps can use it in <img src>.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const eventId = Number((await params).id);
    if (!Number.isInteger(eventId)) return new NextResponse("Not found", { status: 404 });

    const [event] = await db
      .select({ image: events.image, status: events.status })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);
    if (!event || !event.image || event.status === "draft") return new NextResponse("Not found", { status: 404 });

    if (!isDataUrl(event.image)) {
      return NextResponse.redirect(event.image, 302);
    }
    const decoded = decodeDataUrl(event.image);
    if (!decoded) return new NextResponse("Not found", { status: 404 });

    return new NextResponse(new Uint8Array(decoded.bytes), {
      status: 200,
      headers: {
        "Content-Type": decoded.contentType,
        // The URL carries ?v=<updatedAt>, so it is safe to cache hard.
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Poster error:", error);
    return new NextResponse("Server error", { status: 500 });
  }
}
