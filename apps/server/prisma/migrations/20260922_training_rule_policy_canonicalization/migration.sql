-- Canonicalize Training Engine rule JSON after the Stage-driven rule engine rollout.
-- New product semantics use explicit actions:
-- SOFT -> REMIND
-- HARD -> LOCK_SUBMISSION
-- SWITCH_REQUIRED -> FORCE_SWITCH
-- RECOMMEND_SWITCH remains RECOMMEND_SWITCH.

CREATE OR REPLACE FUNCTION pg_temp.canonical_training_time_policy(policy jsonb)
RETURNS jsonb
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN policy IS NULL OR jsonb_typeof(policy) <> 'object' THEN policy
    WHEN COALESCE(policy->>'mode', 'NONE') = 'SOFT'
      THEN jsonb_set(jsonb_set(policy, '{mode}', '"REMIND"'::jsonb, true), '{action}', '"REMIND"'::jsonb, true)
    WHEN COALESCE(policy->>'mode', 'NONE') = 'HARD'
      THEN jsonb_set(jsonb_set(policy, '{mode}', '"LOCK_SUBMISSION"'::jsonb, true), '{action}', '"LOCK_SUBMISSION"'::jsonb, true)
    WHEN COALESCE(policy->>'mode', 'NONE') = 'SWITCH_REQUIRED'
      THEN jsonb_set(jsonb_set(policy, '{mode}', '"FORCE_SWITCH"'::jsonb, true), '{action}', '"FORCE_SWITCH"'::jsonb, true)
    WHEN COALESCE(policy->>'mode', 'NONE') IN ('REMIND', 'RECOMMEND_SWITCH', 'LOCK_SUBMISSION', 'FORCE_SWITCH')
      THEN jsonb_set(policy, '{action}', to_jsonb(policy->>'mode'), true)
    ELSE policy
  END
$$;

-- Stage-level rules.timePolicy.
UPDATE "TrainingSessionStage"
SET "rules" = jsonb_set(
  COALESCE("rules", '{}'::jsonb),
  '{timePolicy}',
  pg_temp.canonical_training_time_policy("rules"->'timePolicy'),
  true
)
WHERE "rules" ? 'timePolicy'
  AND "rules"->'timePolicy' IS NOT NULL;

-- Group-level rules.timePolicy.
UPDATE "TrainingSessionStageGroup"
SET "rules" = jsonb_set(
  COALESCE("rules", '{}'::jsonb),
  '{timePolicy}',
  pg_temp.canonical_training_time_policy("rules"->'timePolicy'),
  true
)
WHERE "rules" ? 'timePolicy'
  AND "rules"->'timePolicy' IS NOT NULL;

-- Stable StageProblem fallback policy.
UPDATE "TrainingSessionStageProblem"
SET "timePolicy" = pg_temp.canonical_training_time_policy("timePolicy")
WHERE "timePolicy" IS NOT NULL;

-- Effective group/problem Plan policy.
UPDATE "TrainingSessionStageProblemPlan"
SET "timePolicy" = pg_temp.canonical_training_time_policy("timePolicy")
WHERE "timePolicy" IS NOT NULL;

-- Template stage rules are Stage generators, so canonicalize them as well.
UPDATE "TrainingSessionTemplateStage"
SET "rules" = jsonb_set(
  COALESCE("rules", '{}'::jsonb),
  '{timePolicy}',
  pg_temp.canonical_training_time_policy("rules"->'timePolicy'),
  true
)
WHERE "rules" ? 'timePolicy'
  AND "rules"->'timePolicy' IS NOT NULL;

-- AccessScope used to be implicit. Materialize CURRENT_STAGE in editable
-- definitions/templates so exported JSON no longer relies on a hidden default.
UPDATE "TrainingSessionStage"
SET "rules" = jsonb_set(COALESCE("rules", '{}'::jsonb), '{accessScope}', '"CURRENT_STAGE"'::jsonb, true)
WHERE NOT (COALESCE("rules", '{}'::jsonb) ? 'accessScope');

UPDATE "TrainingSessionTemplateStage"
SET "rules" = jsonb_set(COALESCE("rules", '{}'::jsonb), '{accessScope}', '"CURRENT_STAGE"'::jsonb, true)
WHERE NOT (COALESCE("rules", '{}'::jsonb) ? 'accessScope');
