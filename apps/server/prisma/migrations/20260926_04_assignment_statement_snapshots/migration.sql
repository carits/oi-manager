-- Backfill immutable statement snapshots for assignments published before snapshotting was introduced.
-- Existing settings are preserved; rows that already carry a snapshot are left untouched.
UPDATE "AssignmentProblem" AS ap
SET "settings" = COALESCE(ap."settings", '{}'::jsonb) || jsonb_build_object(
  'titleSnapshot', p."title",
  'statementsSnapshot', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', ps."id",
        'format', ps."format",
        'language', ps."language",
        'content', ps."content",
        'fileUrl', ps."fileUrl"
      )
      ORDER BY ps."language" NULLS FIRST, ps."createdAt"
    )
    FROM "ProblemStatement" AS ps
    WHERE ps."problemId" = p."id"
      AND ps."type" = 'statement'
      AND ps."isVisible" = TRUE
  ), '[]'::jsonb),
  'statementCapturedAt', CURRENT_TIMESTAMP::text
)
FROM "Problem" AS p, "Assignment" AS a
WHERE ap."problemId" = p."id"
  AND ap."assignmentId" = a."id"
  AND a."status" <> 'DRAFT'
  AND NOT (COALESCE(ap."settings", '{}'::jsonb) ? 'statementsSnapshot');
