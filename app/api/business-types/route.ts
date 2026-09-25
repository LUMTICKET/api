import { NextResponse } from "next/server";
import { getBusinessTypes, serializeBusinessType } from "@/lib/business-types";

/**
 * GET /api/business-types
 * Public endpoint that lists the available business types. The table is
 * seeded by default; pass ?includeInactive=1 to also return disabled rows.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const includeInactive =
      searchParams.get("includeInactive") === "1" ||
      searchParams.get("includeInactive") === "true";

    const rows = await getBusinessTypes({ includeInactive });

    return NextResponse.json({
      businessTypes: rows.map(serializeBusinessType),
    });
  } catch (err) {
    console.error("List business types error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
