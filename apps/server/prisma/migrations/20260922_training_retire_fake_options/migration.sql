-- Retire TrainingSession options that never had supported student-runtime behavior.
-- Fail closed if historical rows ever enabled them; do not silently discard meaning.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "TrainingSession"
    WHERE COALESCE("allowSolution", false) = true
       OR COALESCE("allowDiscussion", false) = true
  ) THEN
    RAISE EXCEPTION
      'Cannot retire TrainingSession.allowSolution/allowDiscussion: enabled historical rows exist';
  END IF;
END
$$;

ALTER TABLE "TrainingSession"
  DROP COLUMN "allowSolution",
  DROP COLUMN "allowDiscussion";
