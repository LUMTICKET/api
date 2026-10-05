-- Business types reference table, seeded with the platform's default types
CREATE TABLE "business_types" (
  "id" serial PRIMARY KEY,
  "name" varchar(100) NOT NULL UNIQUE,
  "slug" varchar(100) NOT NULL UNIQUE,
  "description" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Users can record which business type they operate
ALTER TABLE "users" ADD COLUMN "business_type_id" integer REFERENCES "business_types"("id") ON DELETE SET NULL;

-- Seed default business types (idempotent)
INSERT INTO "business_types" ("name", "slug", "description") VALUES
  ('Event Organizer', 'event-organizer', 'Concerts, festivals, sports, and other live events'),
  ('Bus Operator', 'bus-operator', 'Intercity and shuttle bus services'),
  ('Airline / Flight Operator', 'flight-operator', 'Domestic and international flight services'),
  ('Tourism / Tour Operator', 'tour-operator', 'Tours, parks, attractions, and travel experiences')
ON CONFLICT ("slug") DO NOTHING;
