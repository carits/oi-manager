-- Additive session revocation generation. Existing browser sessions were issued
-- before this claim existed and are treated as generation 1 until rotated.
ALTER TABLE "User"
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1;
