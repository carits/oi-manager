-- Add an explicit library namespace before relaxing the global OJ identifier uniqueness.
ALTER TABLE "Problem"
  ADD COLUMN "libraryScope" TEXT NOT NULL DEFAULT 'platform',
  ADD COLUMN "libraryKey" TEXT NOT NULL DEFAULT 'platform',
  ADD COLUMN "schoolId" TEXT,
  ADD COLUMN "sourceProblemId" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3);

UPDATE "Problem"
SET "publishedAt" = COALESCE("updatedAt", "createdAt")
WHERE status = 'published';

-- Public problems remain platform assets. Existing private teacher problems belong
-- to the creator's school. Abort below if an owner cannot be resolved.
UPDATE "Problem" p
SET
  "libraryScope" = 'school',
  "libraryKey" = 'school:' || u."schoolId",
  "schoolId" = u."schoolId",
  "visibility" = 'private'
FROM "User" u
WHERE p."ownerId" = u.id
  AND p.visibility = 'private';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Problem" p
    LEFT JOIN "User" u ON u.id = p."ownerId"
    WHERE u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Problem library migration aborted: unresolved problem owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Problem"
    WHERE visibility = 'private' AND "schoolId" IS NULL
  ) THEN
    RAISE EXCEPTION 'School problem migration aborted: unresolved private problem owner';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ProblemListEntry" entry
    JOIN "Problem" problem ON problem.id = entry."problemId"
    JOIN "ProblemListSection" section ON section.id = entry."sectionId"
    JOIN "ProblemList" list ON list.id = section."problemListId"
    WHERE problem."libraryScope" = 'school'
      AND (list.scope <> 'campus' OR list."schoolId" IS DISTINCT FROM problem."schoolId")
  ) THEN
    RAISE EXCEPTION 'School problem migration aborted: cross-scope problem-list reference';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "TrainingProblem" training_problem
    JOIN "Problem" problem ON problem.id = training_problem."problemId"
    JOIN "Training" training ON training.id = training_problem."trainingId"
    LEFT JOIN "Team" team ON team.id = training."teamId"
    WHERE problem."libraryScope" = 'school'
      AND (
        training.scope <> 'campus' OR
        COALESCE(training."schoolId", team."schoolId") IS DISTINCT FROM problem."schoolId"
      )
  ) THEN
    RAISE EXCEPTION 'School problem migration aborted: cross-scope training reference';
  END IF;
END $$;

DROP INDEX "Problem_platform_problemId_key";
ALTER TABLE "Problem"
  ADD CONSTRAINT "Problem_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Problem"
  ADD CONSTRAINT "Problem_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Problem"
  ADD CONSTRAINT "Problem_sourceProblemId_fkey"
  FOREIGN KEY ("sourceProblemId") REFERENCES "Problem"(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Problem"
  ADD CONSTRAINT "Problem_library_scope_check"
  CHECK (
    ("libraryScope" = 'platform' AND "schoolId" IS NULL AND "libraryKey" = 'platform') OR
    ("libraryScope" = 'school' AND "schoolId" IS NOT NULL AND "libraryKey" = 'school:' || "schoolId")
  );

CREATE UNIQUE INDEX "Problem_libraryKey_platform_problemId_key"
  ON "Problem"("libraryKey", "platform", "problemId");
CREATE INDEX "Problem_libraryScope_status_idx" ON "Problem"("libraryScope", "status");
CREATE INDEX "Problem_schoolId_status_idx" ON "Problem"("schoolId", "status");
CREATE INDEX "Problem_sourceProblemId_idx" ON "Problem"("sourceProblemId");
