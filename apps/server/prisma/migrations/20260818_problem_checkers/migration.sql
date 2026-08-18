CREATE TABLE "ProblemChecker" (
  "id" TEXT NOT NULL,
  "problemId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "language" TEXT,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProblemChecker_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProblemChecker_problemId_fileName_key" ON "ProblemChecker"("problemId", "fileName");
CREATE INDEX "ProblemChecker_problemId_idx" ON "ProblemChecker"("problemId");
ALTER TABLE "ProblemChecker" ADD CONSTRAINT "ProblemChecker_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "Problem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
