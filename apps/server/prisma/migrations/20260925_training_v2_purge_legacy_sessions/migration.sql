-- Training Engine V2 is the only supported model. Purge all pre-V2 sessions and their dependent runtime data.
-- This migration intentionally fails closed if any V2 row or externally referenced session exists.
DO $$
DECLARE
  v_sessions integer;
  v_v2 integer;
  v_submission_refs integer;
BEGIN
  SELECT count(*) INTO v_sessions FROM "TrainingSession";
  SELECT count(*) INTO v_v2 FROM "TrainingSession" WHERE "groupingModelVersion" >= 2;
  SELECT count(*) INTO v_submission_refs FROM "Submission" WHERE "trainingSessionId" IS NOT NULL;
  IF v_v2 <> 0 THEN
    RAISE EXCEPTION 'training v2 purge refused: % v2 sessions exist', v_v2;
  END IF;
  IF v_submission_refs <> 0 THEN
    RAISE EXCEPTION 'training v2 purge refused: % submission references exist', v_submission_refs;
  END IF;
  RAISE NOTICE 'purging % legacy TrainingSession rows', v_sessions;
  DROP TABLE IF EXISTS "TrainingSessionStageRuntimeSnapshot" CASCADE;
  DELETE FROM "TrainingSession";
END $$;
