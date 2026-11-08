-- Customer ticket purchases: a booking is created only from a succeeded OneKhusa payment.
-- Applied idempotently at request time by lib/ensure-schema.ts as well.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "payment_id" integer UNIQUE REFERENCES "payments"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "ticket_type_id" integer REFERENCES "ticket_types"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "quantity" integer DEFAULT 1 NOT NULL;
