import dotenv from 'dotenv'
import path from 'node:path'
import { Client } from 'pg'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

interface CountRow { count: number }
interface ProjectionRow extends Record<string, number> {
  linked: number
  finalized: number
  active: number
  missingRun: number
  wrongRunOwner: number
  missingAttempt: number
  activeResultMismatch: number
  runResultMismatch: number
  attemptResultMismatch: number
  scoreMismatch: number
  casesMismatch: number
  subtasksMismatch: number
  errorMessageMismatch: number
  timeUsedMismatch: number
  wallTimeUsedMismatch: number
  memoryUsedMismatch: number
  timeoutReasonMismatch: number
  metricSourceMismatch: number
}

async function main() {
  const enforce = process.argv.includes('--enforce')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const result = await client.query<ProjectionRow>(`
      WITH joined AS (
        SELECT
          s.id AS submission_id,
          s.result AS submission_result,
          s.score AS submission_score,
          s.cases AS submission_cases,
          s.subtasks AS submission_subtasks,
          s."errorMessage" AS submission_error,
          s."timeUsed" AS submission_time,
          s."wallTimeUsed" AS submission_wall_time,
          s."memoryUsed" AS submission_memory,
          s."timeoutReason" AS submission_timeout_reason,
          s."metricSource" AS submission_metric_source,
          r.id AS run_id,
          r."submissionId" AS run_submission_id,
          r.status AS run_status,
          r.result AS run_result,
          r.score AS run_score,
          r.cases AS run_cases,
          r.subtasks AS run_subtasks,
          r."errorMessage" AS run_error,
          r."timeUsed" AS run_time,
          r."wallTimeUsed" AS run_wall_time,
          r."memoryUsed" AS run_memory,
          r."timeoutReason" AS run_timeout_reason,
          r."metricSource" AS run_metric_source,
          a.id AS attempt_id,
          a.result AS attempt_result,
          a.score AS attempt_score,
          a.cases AS attempt_cases,
          a.subtasks AS attempt_subtasks,
          a."errorMessage" AS attempt_error,
          a."timeUsed" AS attempt_time,
          a."wallTimeUsed" AS attempt_wall_time,
          a."memoryUsed" AS attempt_memory,
          a."timeoutReason" AS attempt_timeout_reason,
          a."metricSource" AS attempt_metric_source
        FROM "Submission" s
        LEFT JOIN "JudgeRun" r ON r.id = s."currentJudgeRunId"
        LEFT JOIN "JudgeAttempt" a ON a.id = r."currentAttemptId"
        WHERE s."currentJudgeRunId" IS NOT NULL
      )
      SELECT
        count(*)::int AS linked,
        count(*) FILTER (WHERE run_status = 'FINALIZED')::int AS finalized,
        count(*) FILTER (WHERE run_status IN ('QUEUED', 'RUNNING'))::int AS active,
        count(*) FILTER (WHERE run_id IS NULL)::int AS "missingRun",
        count(*) FILTER (WHERE run_id IS NOT NULL AND run_submission_id <> submission_id)::int AS "wrongRunOwner",
        count(*) FILTER (WHERE run_id IS NOT NULL AND attempt_id IS NULL)::int AS "missingAttempt",
        count(*) FILTER (
          WHERE run_status = 'QUEUED' AND submission_result <> 'queuing'
             OR run_status = 'RUNNING' AND submission_result <> 'judging'
        )::int AS "activeResultMismatch",
        count(*) FILTER (WHERE run_status = 'FINALIZED' AND submission_result IS DISTINCT FROM run_result)::int AS "runResultMismatch",
        count(*) FILTER (WHERE run_status = 'FINALIZED' AND run_result IS DISTINCT FROM attempt_result)::int AS "attemptResultMismatch",
        count(*) FILTER (WHERE run_status = 'FINALIZED' AND (submission_score IS DISTINCT FROM run_score OR run_score IS DISTINCT FROM attempt_score))::int AS "scoreMismatch",
        count(*) FILTER (WHERE run_status = 'FINALIZED' AND (submission_cases IS DISTINCT FROM run_cases OR run_cases IS DISTINCT FROM attempt_cases))::int AS "casesMismatch",
        count(*) FILTER (WHERE run_status = 'FINALIZED' AND (submission_subtasks IS DISTINCT FROM run_subtasks OR run_subtasks IS DISTINCT FROM attempt_subtasks))::int AS "subtasksMismatch",
        count(*) FILTER (WHERE run_status = 'FINALIZED' AND (submission_error IS DISTINCT FROM run_error OR run_error IS DISTINCT FROM attempt_error))::int AS "errorMessageMismatch",
        count(*) FILTER (WHERE run_status = 'FINALIZED' AND (submission_time IS DISTINCT FROM run_time OR run_time IS DISTINCT FROM attempt_time))::int AS "timeUsedMismatch",
        count(*) FILTER (WHERE run_status = 'FINALIZED' AND (submission_wall_time IS DISTINCT FROM run_wall_time OR run_wall_time IS DISTINCT FROM attempt_wall_time))::int AS "wallTimeUsedMismatch",
        count(*) FILTER (WHERE run_status = 'FINALIZED' AND (submission_memory IS DISTINCT FROM run_memory OR run_memory IS DISTINCT FROM attempt_memory))::int AS "memoryUsedMismatch",
        count(*) FILTER (WHERE run_status = 'FINALIZED' AND (submission_timeout_reason IS DISTINCT FROM run_timeout_reason OR run_timeout_reason IS DISTINCT FROM attempt_timeout_reason))::int AS "timeoutReasonMismatch",
        count(*) FILTER (WHERE run_status = 'FINALIZED' AND (submission_metric_source IS DISTINCT FROM run_metric_source OR run_metric_source IS DISTINCT FROM attempt_metric_source))::int AS "metricSourceMismatch"
      FROM joined
    `)
    const row = result.rows[0]
    const metadataKeys = new Set(['linked', 'finalized', 'active'])
    const violations = Object.entries(row)
      .filter(([key, value]) => !metadataKeys.has(key) && Number(value) > 0)
      .map(([key, value]) => `${key}: ${value}`)
    const unpinned = await client.query<CountRow>(`
      SELECT count(*)::int AS count
      FROM "Submission"
      WHERE "submitMethod" = 'local' AND "currentJudgeRunId" IS NULL
    `)
    console.log(JSON.stringify({
      ...row,
      legacyLocalWithoutRun: unpinned.rows[0].count,
      status: violations.length ? 'mismatch' : 'consistent',
      violations,
    }, null, 2))
    if (enforce && violations.length) process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
