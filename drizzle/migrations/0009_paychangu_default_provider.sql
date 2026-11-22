-- PayChangu is the only payment provider. Existing rows keep the provider they were created with.
ALTER TABLE "payments" ALTER COLUMN "provider" SET DEFAULT 'paychangu';
