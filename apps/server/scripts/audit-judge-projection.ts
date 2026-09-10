import dotenv from 'dotenv'
import path from 'node:path'
import { Client } from 'pg'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })

interface ProjectionRow extends Record<string, number> {
  linked: number; finalized: number; active: number; missingRun: number; wrongRunOwner: number; missingAttempt: number
  attemptResultMismatch: number; scoreMismatch: number; casesMismatch: number; subtasksMismatch: number
  errorMessageMismatch: number; timeUsedMismatch: number; wallTimeUsedMismatch: number; memoryUsedMismatch: number
  timeoutReasonMismatch: number; metricSourceMismatch: number; localWithoutRun: number
}

async function main() {
  const enforce = process.argv.includes('--enforce')
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const result = await client.query<ProjectionRow>(`
      WITH joined AS (
        SELECT s.id submission_id, r.id run_id, r."submissionId" run_submission_id,
          r.status run_status, r.result run_result, r.score run_score, r.cases run_cases,
          r.subtasks run_subtasks, r."errorMessage" run_error, r."timeUsed" run_time,
          r."wallTimeUsed" run_wall_time, r."memoryUsed" run_memory,
          r."timeoutReason" run_timeout_reason, r."metricSource" run_metric_source,
          a.id attempt_id, a.result attempt_result, a.score attempt_score, a.cases attempt_cases,
          a.subtasks attempt_subtasks, a."errorMessage" attempt_error, a."timeUsed" attempt_time,
          a."wallTimeUsed" attempt_wall_time, a."memoryUsed" attempt_memory,
          a."timeoutReason" attempt_timeout_reason, a."metricSource" attempt_metric_source
        FROM "Submission" s
        LEFT JOIN "JudgeRun" r ON r.id = s."currentJudgeRunId"
        LEFT JOIN "JudgeAttempt" a ON a.id = r."currentAttemptId"
        WHERE s."currentJudgeRunId" IS NOT NULL
      )
      SELECT count(*)::int linked,
        count(*) FILTER (WHERE run_status = 'FINALIZED')::int finalized,
        count(*) FILTER (WHERE run_status IN ('QUEUED','RUNNING'))::int active,
        count(*) FILTER (WHERE run_id IS NULL)::int "missingRun",
        count(*) FILTER (WHERE run_id IS NOT NULL AND run_submission_id <> submission_id)::int "wrongRunOwner",
        count(*) FILTER (WHERE run_id IS NOT NULL AND attempt_id IS NULL)::int "missingAttempt",
        count(*) FILTER (WHERE run_status='FINALIZED' AND run_result IS DISTINCT FROM attempt_result)::int "attemptResultMismatch",
        count(*) FILTER (WHERE run_status='FINALIZED' AND run_score IS DISTINCT FROM attempt_score)::int "scoreMismatch",
        count(*) FILTER (WHERE run_status='FINALIZED' AND run_cases IS DISTINCT FROM attempt_cases)::int "casesMismatch",
        count(*) FILTER (WHERE run_status='FINALIZED' AND run_subtasks IS DISTINCT FROM attempt_subtasks)::int "subtasksMismatch",
        count(*) FILTER (WHERE run_status='FINALIZED' AND run_error IS DISTINCT FROM attempt_error)::int "errorMessageMismatch",
        count(*) FILTER (WHERE run_status='FINALIZED' AND run_time IS DISTINCT FROM attempt_time)::int "timeUsedMismatch",
        count(*) FILTER (WHERE run_status='FINALIZED' AND run_wall_time IS DISTINCT FROM attempt_wall_time)::int "wallTimeUsedMismatch",
        count(*) FILTER (WHERE run_status='FINALIZED' AND run_memory IS DISTINCT FROM attempt_memory)::int "memoryUsedMismatch",
        count(*) FILTER (WHERE run_status='FINALIZED' AND run_timeout_reason IS DISTINCT FROM attempt_timeout_reason)::int "timeoutReasonMismatch",
        count(*) FILTER (WHERE run_status='FINALIZED' AND run_metric_source IS DISTINCT FROM attempt_metric_source)::int "metricSourceMismatch",
        (SELECT count(*)::int FROM "Submission" WHERE "submitMethod" IN ('local','demo_scenario') AND "currentJudgeRunId" IS NULL) "localWithoutRun"
      FROM joined
    `)
    const row = result.rows[0]
    const informational = new Set(['linked', 'finalized', 'active'])
    const violations = Object.entries(row).filter(([key, value]) => !informational.has(key) && Number(value) > 0).map(([key, value]) => `${key}: ${value}`)
    console.log(JSON.stringify({ ...row, localResultSource: 'JudgeRun', archiveResultSource: 'Submission', status: violations.length ? 'mismatch' : 'consistent', violations }, null, 2))
    if (enforce && violations.length) process.exitCode = 1
  } finally { await client.end() }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
