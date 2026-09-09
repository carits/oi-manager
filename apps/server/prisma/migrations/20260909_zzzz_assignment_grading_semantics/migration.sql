CREATE TYPE "AssignmentOptionalScoringPolicy" AS ENUM ('NONE', 'BONUS', 'BEST_N');
CREATE TYPE "AssignmentChallengeScoringPolicy" AS ENUM ('NONE', 'EXTRA_CREDIT');

ALTER TABLE "Assignment"
  ADD COLUMN "gradingVersion" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "baseScoreMax" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "optionalScoringPolicy" "AssignmentOptionalScoringPolicy" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "optionalBestCount" INTEGER,
  ADD COLUMN "optionalBonusMax" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "challengeScoringPolicy" "AssignmentChallengeScoringPolicy" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "challengeBonusMax" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "AssignmentProblem"
  ADD COLUMN "judgeMaxScore" INTEGER NOT NULL DEFAULT 100;

ALTER TABLE "AssignmentCorrection"
  ADD COLUMN "requiredScore" INTEGER;

ALTER TABLE "Assignment"
  ADD CONSTRAINT "Assignment_grading_limits_check" CHECK (
    "gradingVersion" >= 1
    AND "baseScoreMax" BETWEEN 1 AND 1000
    AND "optionalBonusMax" BETWEEN 0 AND 1000
    AND "challengeBonusMax" BETWEEN 0 AND 1000
    AND ("optionalBestCount" IS NULL OR "optionalBestCount" BETWEEN 1 AND 1000)
  );

ALTER TABLE "AssignmentProblem"
  ADD CONSTRAINT "AssignmentProblem_judge_max_score_check" CHECK ("judgeMaxScore" > 0);

ALTER TABLE "AssignmentCorrection"
  ADD CONSTRAINT "AssignmentCorrection_required_score_check" CHECK ("requiredScore" IS NULL OR "requiredScore" >= 0);
