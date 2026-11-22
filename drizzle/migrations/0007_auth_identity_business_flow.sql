-- Auth & business-flow upgrade:
--   * users gain a unique Business ID login code, phone, isInBusiness,
--     "which business" (business_profile_id) and a 2FA toggle.
--   * business_profiles gain business_type_id and relax the KYB detail
--     columns so the first business form can stay minimal.
--   * two_factor_challenges stores hashed login verification codes.
-- The same statements are applied idempotently at request time by
-- lib/ensure-auth-schema.ts, so this file is safe to re-run.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" varchar(50);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "business_id" varchar(32);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_in_business" boolean DEFAULT false NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "business_profile_id" integer REFERENCES "business_profiles"("id") ON DELETE SET NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT true NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_unique" ON "users" ("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "users_business_id_unique" ON "users" ("business_id");

ALTER TABLE "business_profiles" ADD COLUMN IF NOT EXISTS "business_type_id" integer REFERENCES "business_types"("id") ON DELETE SET NULL;

-- The first business form only asks for the business name + type, so the
-- KYB detail fields become optional until the dashboard completion step.
ALTER TABLE "business_profiles" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "business_profiles" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "business_profiles" ALTER COLUMN "address" DROP NOT NULL;
ALTER TABLE "business_profiles" ALTER COLUMN "city" DROP NOT NULL;
ALTER TABLE "business_profiles" ALTER COLUMN "country" DROP NOT NULL;

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
);

-- Backfill: every account that already owns a business profile is inside
-- that business; business type is mirrored onto the profile.
UPDATE "users" u
SET "is_in_business" = true,
    "business_profile_id" = bp."id",
    "business_type_id" = COALESCE(u."business_type_id", bp."business_type_id")
FROM "business_profiles" bp
WHERE bp."user_id" = u."id"
  AND u."business_profile_id" IS NULL;

UPDATE "business_profiles" bp
SET "business_type_id" = u."business_type_id"
FROM "users" u
WHERE u."id" = bp."user_id"
  AND bp."business_type_id" IS NULL
  AND u."business_type_id" IS NOT NULL;

-- Backfill: every existing account gets a unique Business ID login code.
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
END $$;
