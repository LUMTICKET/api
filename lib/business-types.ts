import { and, asc, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { businessTypes, users } from "@/drizzle/schema";
import type { BusinessType } from "@/drizzle/schema";

/* ── Default business types shipped with the platform ── */
export interface DefaultBusinessType {
  name: string;
  slug: string;
  description: string;
}

export const DEFAULT_BUSINESS_TYPES: DefaultBusinessType[] = [
  {
    name: "Event Organizer",
    slug: "event-organizer",
    description: "Concerts, festivals, sports, and other live events",
  },
  {
    name: "Bus Operator",
    slug: "bus-operator",
    description: "Intercity and shuttle bus services",
  },
  {
    name: "Airline / Flight Operator",
    slug: "flight-operator",
    description: "Domestic and international flight services",
  },
  {
    name: "Tourism / Tour Operator",
    slug: "tour-operator",
    description: "Tours, parks, attractions, and travel experiences",
  },
];

let ensurePromise: Promise<void> | null = null;

/**
 * Idempotently creates the business_types table, the users.business_type_id
 * column, and seeds the default business types. Runs once per server process.
 */
export function ensureBusinessTypes(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "business_types" (
          "id" serial PRIMARY KEY,
          "name" varchar(100) NOT NULL UNIQUE,
          "slug" varchar(100) NOT NULL UNIQUE,
          "description" text,
          "is_active" boolean DEFAULT true NOT NULL,
          "created_at" timestamp DEFAULT now() NOT NULL,
          "updated_at" timestamp DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "business_type_id" integer
        REFERENCES "business_types"("id") ON DELETE SET NULL
      `);
      await db
        .insert(businessTypes)
        .values(DEFAULT_BUSINESS_TYPES)
        .onConflictDoNothing();
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

/** Lists the available business types (active ones by default). */
export async function getBusinessTypes(options?: {
  includeInactive?: boolean;
}): Promise<BusinessType[]> {
  await ensureBusinessTypes();

  if (options?.includeInactive) {
    return db.select().from(businessTypes).orderBy(asc(businessTypes.name));
  }

  return db
    .select()
    .from(businessTypes)
    .where(eq(businessTypes.isActive, true))
    .orderBy(asc(businessTypes.name));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Resolves a business type from an id (number or numeric string), a slug,
 * or a business type name. Returns null when nothing matches.
 */
export async function resolveBusinessType(
  input: unknown
): Promise<BusinessType | null> {
  if (input === null || input === undefined) return null;
  await ensureBusinessTypes();

  const byId = async (id: number) => {
    const [row] = await db
      .select()
      .from(businessTypes)
      .where(eq(businessTypes.id, id))
      .limit(1);
    return row ?? null;
  };

  if (typeof input === "number" && Number.isInteger(input) && input > 0) {
    return byId(input);
  }

  if (typeof input === "string") {
    const raw = input.trim();
    if (!raw) return null;

    if (/^\d+$/.test(raw)) {
      const match = await byId(Number(raw));
      if (match) return match;
    }

    const slug = slugify(raw);
    const [row] = await db
      .select()
      .from(businessTypes)
      .where(
        or(
          eq(businessTypes.slug, slug),
          sql`lower(${businessTypes.name}) = ${raw.toLowerCase()}`
        )
      )
      .limit(1);
    return row ?? null;
  }

  return null;
}

/** Returns the business type linked to a user, or null when unset. */
export async function getBusinessTypeForUser(
  userId: number
): Promise<BusinessType | null> {
  const [row] = await db
    .select({ businessType: businessTypes })
    .from(users)
    .innerJoin(businessTypes, eq(users.businessTypeId, businessTypes.id))
    .where(and(eq(users.id, userId), eq(businessTypes.isActive, true)))
    .limit(1);
  return row?.businessType ?? null;
}

/** Sets (or clears) the business type on a user record. */
export async function setBusinessTypeForUser(
  userId: number,
  businessTypeId: number | null
) {
  const [updated] = await db
    .update(users)
    .set({ businessTypeId, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  return updated ?? null;
}

/** Public JSON shape used in API responses. */
export function serializeBusinessType(businessType: BusinessType | null) {
  if (!businessType) return null;
  return {
    id: businessType.id,
    name: businessType.name,
    slug: businessType.slug,
    description: businessType.description,
  };
}
