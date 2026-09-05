ALTER TABLE "School"
ADD COLUMN "directoryStatus" TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE "School"
ADD CONSTRAINT "School_directoryStatus_check"
CHECK ("directoryStatus" IN ('pending', 'verified', 'hidden', 'legacy'));

CREATE INDEX "School_directoryStatus_status_idx"
ON "School"("directoryStatus", "status");
