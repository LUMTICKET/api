import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ensureBusinessTypes } from "@/lib/business-types";

/**
 * Idempotent bootstrap for the auth/business-flow upgrade (migration 0007):
 *   users.phone / users.business_id / users.is_in_business /
 *   users.business_profile_id / users.two_factor_enabled,
 *   business_profiles.business_type_id (plus relaxed KYB columns),
 *   and the two_factor_challenges table.
 *
 * Mirrors drizzle/migrations/0007_auth_identity_business_flow.sql so the API
 * also works on databases that only ever ran the runtime ensures. Runs once
 * per server process; failures reset the cached promise.
 */
let ensurePromise: Promise<void> | null = null;

export function ensureAuthSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = runEnsure().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function runEnsure() {
  // business_profiles.business_type_id references business_types.
  await ensureBusinessTypes();

  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" varchar(50)`);
  await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "business_id" varchar(32)`);
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_in_business" boolean DEFAULT false NOT NULL`
  );
  await db.execute(sql`
    ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "business_profile_id" integer
    REFERENCES "business_profiles"("id") ON DELETE SET NULL
  `);
  await db.execute(
    sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT true NOT NULL`
  );

  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_unique" ON "users" ("phone")`);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "users_business_id_unique" ON "users" ("business_id")`
  );

  await db.execute(sql`
    ALTER TABLE "business_profiles" ADD COLUMN IF NOT EXISTS "business_type_id" integer
    REFERENCES "business_types"("id") ON DELETE SET NULL
  `);

  // The first business form is intentionally minimal, so KYB detail columns
  // are optional until the dashboard completion step fills them in.
  await db.execute(sql`ALTER TABLE "business_profiles" ALTER COLUMN "email" DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE "business_profiles" ALTER COLUMN "phone" DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE "business_profiles" ALTER COLUMN "address" DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE "business_profiles" ALTER COLUMN "city" DROP NOT NULL`);
  await db.execute(sql`ALTER TABLE "business_profiles" ALTER COLUMN "country" DROP NOT NULL`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "two_factor_challenges" (
      "id" serial PRIMARY KEY,
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "token" varchar(255) NOT NULL UNIQUE,
      "code_hash" varchar(255) NOT NULL,
      "channel" varchar(20) DEFAULT 'email' NOT NULL,
      "attempts" integer DEFAULT 0 NOT NULL,
      "expires_at" timestamp NOT NULL,
      "consumed_at" timestamp,
      "created_at" timestamp DEFAULT now() NOT NULL,
      "updated_at" timestamp DEFAULT now() NOT NULL
    )
  `);

  // Existing owners are inside their business; mirror the business type.
  await db.execute(sql`
    UPDATE "users" u
    SET "is_in_business" = true,
        "business_profile_id" = bp."id",
        "business_type_id" = COALESCE(u."business_type_id", bp."business_type_id")
    FROM "business_profiles" bp
    WHERE bp."user_id" = u."id"
      AND u."business_profile_id" IS NULL
  `);
  await db.execute(sql`
    UPDATE "business_profiles" bp
    SET "business_type_id" = u."business_type_id"
    FROM "users" u
    WHERE u."id" = bp."user_id"
      AND bp."business_type_id" IS NULL
      AND u."business_type_id" IS NOT NULL
  `);

  // Every account gets a unique Business ID login code.
  await db.execute(sql`
    DO $$
    DECLARE
      u record;
      code text;
      tries int;
    BEGIN
      FOR u IN SELECT "id" FROM "users" WHERE "business_id" IS NULL LOOP
        tries := 0;
        LOOP
          code := 'LMT-' || upper(substr(md5(random()::text || u."id"::text || clock_timestamp()::text), 1, 8));
          BEGIN
            UPDATE "users" SET "business_id" = code WHERE "id" = u."id";
            EXIT;
          EXCEPTION WHEN unique_violation THEN
            tries := tries + 1;
            IF tries >= 10 THEN RAISE; END IF;
          END;
        END LOOP;
      END LOOP;
    END $$
  `);
}
