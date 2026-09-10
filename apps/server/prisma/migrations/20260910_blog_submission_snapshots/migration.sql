ALTER TYPE "BlogReferenceType" ADD VALUE IF NOT EXISTS 'SUBMISSION_SNAPSHOT';

CREATE TABLE "BlogSubmissionSnapshot" (
  "id" TEXT NOT NULL,
  "submissionId" INTEGER NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "visibility" "BlogVisibility" NOT NULL DEFAULT 'PRIVATE',
  "includeCode" BOOLEAN NOT NULL DEFAULT false,
  "sourcePlatform" TEXT NOT NULL,
  "sourceProblemId" TEXT NOT NULL,
  "problemTitle" TEXT,
  "result" TEXT NOT NULL,
  "score" INTEGER,
  "timeUsed" INTEGER,
  "memoryUsed" INTEGER,
  "language" TEXT NOT NULL,
  "inputFilename" TEXT,
  "outputFilename" TEXT,
  "code" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BlogSubmissionSnapshot_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BlogReference" ADD COLUMN "submissionSnapshotId" TEXT;
ALTER TABLE "BlogSubmissionSnapshot" ADD CONSTRAINT "BlogSubmissionSnapshot_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogSubmissionSnapshot" ADD CONSTRAINT "BlogSubmissionSnapshot_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BlogReference" ADD CONSTRAINT "BlogReference_submissionSnapshotId_fkey" FOREIGN KEY ("submissionSnapshotId") REFERENCES "BlogSubmissionSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "BlogSubmissionSnapshot_ownerUserId_createdAt_idx" ON "BlogSubmissionSnapshot"("ownerUserId", "createdAt");
CREATE INDEX "BlogSubmissionSnapshot_submissionId_createdAt_idx" ON "BlogSubmissionSnapshot"("submissionId", "createdAt");
CREATE INDEX "BlogSubmissionSnapshot_contentHash_idx" ON "BlogSubmissionSnapshot"("contentHash");
CREATE INDEX "BlogReference_submissionSnapshotId_idx" ON "BlogReference"("submissionSnapshotId");

CREATE OR REPLACE FUNCTION reject_blog_submission_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'BlogSubmissionSnapshot is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BlogSubmissionSnapshot_no_update"
BEFORE UPDATE ON "BlogSubmissionSnapshot"
FOR EACH ROW EXECUTE FUNCTION reject_blog_submission_snapshot_mutation();

CREATE TRIGGER "BlogSubmissionSnapshot_no_delete"
BEFORE DELETE ON "BlogSubmissionSnapshot"
FOR EACH ROW EXECUTE FUNCTION reject_blog_submission_snapshot_mutation();
