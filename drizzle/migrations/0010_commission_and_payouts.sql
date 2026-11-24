-- Tiered commission (small 5% / standard 7% / premium 8%) and automatic organiser payouts.
-- Applied idempotently at request time by lib/ensure-schema.ts as well.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "tier" varchar(10) DEFAULT 'standard' NOT NULL;

ALTER TABLE "business_profiles"
  ADD COLUMN IF NOT EXISTS "payout_method" varchar(10),
  ADD COLUMN IF NOT EXISTS "payout_account_name" varchar(255),
  ADD COLUMN IF NOT EXISTS "payout_account_number" varchar(50),
  ADD COLUMN IF NOT EXISTS "payout_bank_uuid" varchar(100);

CREATE TABLE IF NOT EXISTS "payouts" (
  "id" serial PRIMARY KEY,
  "payment_id" integer NOT NULL UNIQUE REFERENCES "payments"("id") ON DELETE RESTRICT,
  "business_profile_id" integer NOT NULL REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "event_id" integer,
  "tier" varchar(10) NOT NULL,
  "gross_amount" integer NOT NULL,
  "commission_rate" numeric(5,2) NOT NULL,
  "commission_amount" integer NOT NULL,
  "net_amount" integer NOT NULL,
  "currency" varchar(3) DEFAULT 'MWK' NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "charge_id" varchar(100) NOT NULL UNIQUE,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "sent_at" timestamp,
  "paid_email_at" timestamp,
  "details_email_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
