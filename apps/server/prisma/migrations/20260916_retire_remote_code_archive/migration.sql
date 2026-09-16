-- Remote OJ code/submission archives are no longer a supported product
-- capability. Normal remote judge submissions keep their remote identity.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Submission" s
    WHERE s."submitMethod" = 'archive'
      AND (
        s."currentJudgeRunId" IS NOT NULL
        OR s."trainingId" IS NOT NULL
        OR s."trainingSessionId" IS NOT NULL
        OR s."assignmentId" IS NOT NULL
        OR s."canonicalContestId" IS NOT NULL
        OR EXISTS (SELECT 1 FROM "JudgeRun" r WHERE r."submissionId" = s.id)
        OR EXISTS (SELECT 1 FROM "BlogSubmissionSnapshot" b WHERE b."submissionId" = s.id)
        OR EXISTS (SELECT 1 FROM "SolutionVerification" v WHERE v."submissionId" = s.id)
      )
  ) THEN
    RAISE EXCEPTION 'remote archive submissions still have business references';
  END IF;
END $$;

DELETE FROM "Submission" WHERE "submitMethod" = 'archive';
DROP TABLE "UserArchivedProblem";

ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_submitMethod_no_remote_archive"
  CHECK ("submitMethod" <> 'archive');
