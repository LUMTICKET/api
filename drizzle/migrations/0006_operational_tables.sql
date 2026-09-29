-- Operational tables: catalog, bookings, fleet, field ops, couriers, finance, platform admin.
-- Conventions: snake_case, serial PKs, created_at/updated_at timestamps, integer minor units + currency code.

CREATE TABLE "countries" (
  "code" varchar(2) PRIMARY KEY,
  "name" text NOT NULL,
  "currency" varchar(3) NOT NULL,
  "flag" varchar(8),
  "live" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "bus_routes" (
  "id" serial PRIMARY KEY,
  "business_profile_id" integer NOT NULL REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "origin" varchar(255) NOT NULL,
  "destination" varchar(255) NOT NULL,
  "duration" varchar(50),
  "from_price" integer,
  "currency" varchar(3) DEFAULT 'MWK' NOT NULL,
  "departures_per_day" integer DEFAULT 1 NOT NULL,
  "rating" numeric(2,1),
  "is_published" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "bookings" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" varchar(20) NOT NULL,
  "reference" varchar(64) NOT NULL UNIQUE,
  "title" text NOT NULL,
  "detail" text,
  "scheduled_for" timestamptz NOT NULL,
  "amount" integer DEFAULT 0 NOT NULL,
  "currency" varchar(3) DEFAULT 'MWK' NOT NULL,
  "status" varchar(20) DEFAULT 'upcoming' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "vehicles" (
  "id" serial PRIMARY KEY,
  "business_profile_id" integer NOT NULL REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "plate" varchar(30) NOT NULL,
  "type" varchar(100),
  "capacity" integer DEFAULT 0 NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "roadworthy_expiry" date,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "drivers" (
  "id" serial PRIMARY KEY,
  "business_profile_id" integer NOT NULL REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "name" varchar(255) NOT NULL,
  "phone" varchar(50),
  "status" varchar(20) DEFAULT 'available' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "schedules" (
  "id" serial PRIMARY KEY,
  "business_profile_id" integer NOT NULL REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "route_id" integer NOT NULL REFERENCES "bus_routes"("id") ON DELETE CASCADE,
  "vehicle_id" integer REFERENCES "vehicles"("id") ON DELETE SET NULL,
  "driver_id" integer REFERENCES "drivers"("id") ON DELETE SET NULL,
  "departure_at" timestamptz NOT NULL,
  "seats_total" integer DEFAULT 0 NOT NULL,
  "seats_sold" integer DEFAULT 0 NOT NULL,
  "status" varchar(20) DEFAULT 'scheduled' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "bus_bookings" (
  "id" serial PRIMARY KEY,
  "business_profile_id" integer NOT NULL REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "reference" varchar(64) NOT NULL UNIQUE,
  "customer_name" varchar(255) NOT NULL,
  "schedule_id" integer REFERENCES "schedules"("id") ON DELETE SET NULL,
  "seats" jsonb DEFAULT '[]'::jsonb,
  "amount" integer DEFAULT 0 NOT NULL,
  "currency" varchar(3) DEFAULT 'MWK' NOT NULL,
  "channel" varchar(20) DEFAULT 'online' NOT NULL,
  "status" varchar(20) DEFAULT 'confirmed' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "couriers" (
  "id" serial PRIMARY KEY,
  "business_profile_id" integer NOT NULL REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "name" varchar(255) NOT NULL,
  "zone" varchar(255),
  "vehicle" varchar(255),
  "status" varchar(20) DEFAULT 'available' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "parcels" (
  "id" serial PRIMARY KEY,
  "business_profile_id" integer NOT NULL REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "reference" varchar(64) NOT NULL UNIQUE,
  "sender_name" varchar(255) NOT NULL,
  "recipient_name" varchar(255) NOT NULL,
  "origin" varchar(255) NOT NULL,
  "destination" varchar(255) NOT NULL,
  "weight_kg" numeric(6,2),
  "courier_id" integer REFERENCES "couriers"("id") ON DELETE SET NULL,
  "status" varchar(30) DEFAULT 'registered' NOT NULL,
  "amount" integer DEFAULT 0 NOT NULL,
  "currency" varchar(3) DEFAULT 'MWK' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "parcel_events" (
  "id" serial PRIMARY KEY,
  "parcel_id" integer NOT NULL REFERENCES "parcels"("id") ON DELETE CASCADE,
  "location" varchar(255),
  "status" varchar(30) NOT NULL,
  "scanned_by" varchar(255),
  "occurred_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "scan_events" (
  "id" serial PRIMARY KEY,
  "business_profile_id" integer NOT NULL REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "code" varchar(255) NOT NULL,
  "kind" varchar(20) NOT NULL,
  "result" varchar(20) NOT NULL,
  "mode" varchar(20) DEFAULT 'auto' NOT NULL,
  "device" varchar(100),
  "synced" boolean DEFAULT true NOT NULL,
  "occurred_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "pos_transactions" (
  "id" serial PRIMARY KEY,
  "agent_profile_id" integer NOT NULL REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "occurred_at" timestamptz DEFAULT now() NOT NULL,
  "kind" varchar(20) NOT NULL,
  "reference" varchar(64),
  "amount" integer NOT NULL,
  "currency" varchar(3) DEFAULT 'MWK' NOT NULL,
  "method" varchar(20) DEFAULT 'cash' NOT NULL
);

CREATE TABLE "till_sessions" (
  "id" serial PRIMARY KEY,
  "agent_profile_id" integer NOT NULL REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "opened_at" timestamptz DEFAULT now() NOT NULL,
  "closed_at" timestamptz,
  "opening_float" integer DEFAULT 0 NOT NULL,
  "limit_amount" integer,
  "currency" varchar(3) DEFAULT 'MWK' NOT NULL,
  "cash_sales" integer,
  "mobile_sales" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "driver_assignments" (
  "id" serial PRIMARY KEY,
  "business_profile_id" integer NOT NULL CONSTRAINT "driver_assignments_profile_fk" REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "driver_id" integer NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
  "vehicle_id" integer REFERENCES "vehicles"("id") ON DELETE SET NULL,
  "schedule_id" integer REFERENCES "schedules"("id") ON DELETE SET NULL,
  "status" varchar(20) DEFAULT 'upcoming' NOT NULL,
  "passenger_count" integer DEFAULT 0 NOT NULL,
  "parcel_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "compliance_documents" (
  "id" serial PRIMARY KEY,
  "business_profile_id" integer NOT NULL CONSTRAINT "compliance_documents_profile_fk" REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "subject" varchar(255) NOT NULL,
  "kind" varchar(255) NOT NULL,
  "expires_at" date NOT NULL,
  "document_url" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "settlements" (
  "id" serial PRIMARY KEY,
  "business_profile_id" integer NOT NULL REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "gross_amount" integer DEFAULT 0 NOT NULL,
  "commission_amount" integer DEFAULT 0 NOT NULL,
  "net_amount" integer DEFAULT 0 NOT NULL,
  "currency" varchar(3) DEFAULT 'MWK' NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "paid_at" timestamptz,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "commission_rules" (
  "id" serial PRIMARY KEY,
  "service" varchar(20) NOT NULL UNIQUE,
  "rate" numeric(4,2) NOT NULL,
  "effective_from" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "reconciliation_flags" (
  "id" serial PRIMARY KEY,
  "gateway_ref" varchar(100) NOT NULL UNIQUE,
  "amount" integer DEFAULT 0 NOT NULL,
  "currency" varchar(3) DEFAULT 'MWK' NOT NULL,
  "issue" text,
  "status" varchar(30) DEFAULT 'needs-review' NOT NULL,
  "detected_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "kyc_reviews" (
  "id" serial PRIMARY KEY,
  "business_profile_id" integer NOT NULL UNIQUE REFERENCES "business_profiles"("id") ON DELETE CASCADE,
  "submitted_at" timestamptz DEFAULT now() NOT NULL,
  "risk_tier" varchar(10) DEFAULT 'low' NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "reviewer_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at" timestamptz,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "permissions" (
  "id" serial PRIMARY KEY,
  "key" varchar(64) NOT NULL UNIQUE,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "platform_roles" (
  "id" serial PRIMARY KEY,
  "name" varchar(100) NOT NULL UNIQUE,
  "scope" varchar(20) DEFAULT 'platform' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "platform_role_permissions" (
  "id" serial PRIMARY KEY,
  "role_id" integer NOT NULL REFERENCES "platform_roles"("id") ON DELETE CASCADE,
  "permission_id" integer NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE,
  CONSTRAINT "platform_role_permissions_role_permission_unique" UNIQUE ("role_id", "permission_id")
);

CREATE TABLE "user_platform_roles" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role_id" integer NOT NULL REFERENCES "platform_roles"("id") ON DELETE CASCADE,
  CONSTRAINT "user_platform_roles_user_role_unique" UNIQUE ("user_id", "role_id")
);

CREATE TABLE "platform_audit_log" (
  "id" serial PRIMARY KEY,
  "actor" varchar(255) NOT NULL,
  "action" text NOT NULL,
  "target" text,
  "occurred_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "support_cases" (
  "id" serial PRIMARY KEY,
  "reference" varchar(64),
  "customer_name" varchar(255) NOT NULL,
  "subject" text NOT NULL,
  "kind" varchar(20) DEFAULT 'bus' NOT NULL,
  "status" varchar(20) DEFAULT 'open' NOT NULL,
  "opened_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- New columns on existing tables
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "venue" varchar(255),
  ADD COLUMN IF NOT EXISTS "city" varchar(100),
  ADD COLUMN IF NOT EXISTS "country_code" varchar(2);

ALTER TABLE "business_profiles"
  ADD COLUMN IF NOT EXISTS "commission_rate" numeric(5,2),
  ADD COLUMN IF NOT EXISTS "account_status" varchar(20) DEFAULT 'active' NOT NULL;

-- Reference data: countries
INSERT INTO "countries" ("code", "name", "currency", "flag", "live") VALUES
  ('MW', 'Malawi', 'MWK', '🇲🇼', true),
  ('ZM', 'Zambia', 'ZMW', '🇿🇲', true),
  ('ZW', 'Zimbabwe', 'USD', '🇿🇼', true),
  ('MZ', 'Mozambique', 'MZN', '🇲🇿', false),
  ('TZ', 'Tanzania', 'TZS', '🇹🇿', false),
  ('ZA', 'South Africa', 'ZAR', '🇿🇦', false),
  ('BW', 'Botswana', 'BWP', '🇧🇼', false),
  ('NA', 'Namibia', 'NAD', '🇳🇦', false)
ON CONFLICT ("code") DO NOTHING;

-- Reference data: platform permissions
INSERT INTO "permissions" ("key") VALUES
  ('manage-commission'), ('review-kyc'), ('manage-roles'), ('view-bookings'),
  ('process-bookings'), ('view-finance'), ('dispatch'), ('validate-tickets'),
  ('sell-at-pos'), ('support-actions')
ON CONFLICT ("key") DO NOTHING;

-- Reference data: default commission rules
INSERT INTO "commission_rules" ("service", "rate") VALUES
  ('bus', 10), ('events', 8), ('parcels', 12), ('agent', 2), ('gateway', 2.5)
ON CONFLICT ("service") DO NOTHING;

-- Seed an initial platform admin role with all permissions
INSERT INTO "platform_roles" ("name", "scope") VALUES ('Super Admin', 'platform')
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "platform_role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "platform_roles" r CROSS JOIN "permissions" p
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;
