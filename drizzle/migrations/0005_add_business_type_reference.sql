-- Kept minimal: 0004 already creates business_types and seeds defaults.
-- This file exists so the journal numbering is contiguous; it is idempotent.
INSERT INTO "business_types" ("name", "slug", "description")
SELECT 'Event Organizer', 'event-organizer', 'Concerts, festivals, sports, and other live events'
WHERE NOT EXISTS (SELECT 1 FROM "business_types" WHERE "slug" = 'event-organizer');

INSERT INTO "business_types" ("name", "slug", "description")
SELECT 'Bus Operator', 'bus-operator', 'Intercity and shuttle bus services'
WHERE NOT EXISTS (SELECT 1 FROM "business_types" WHERE "slug" = 'bus-operator');

INSERT INTO "business_types" ("name", "slug", "description")
SELECT 'Airline / Flight Operator', 'flight-operator', 'Domestic and international flight services'
WHERE NOT EXISTS (SELECT 1 FROM "business_types" WHERE "slug" = 'flight-operator');

INSERT INTO "business_types" ("name", "slug", "description")
SELECT 'Tourism / Tour Operator', 'tour-operator', 'Tours, parks, attractions, and travel experiences'
WHERE NOT EXISTS (SELECT 1 FROM "business_types" WHERE "slug" = 'tour-operator');
