import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.DATABASE_URL
const schema = `training_migration_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
let client: Client

describe.skipIf(!databaseUrl)('training stage terminal lifecycle migration', () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl })
    await client.connect()
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}"`)
    await client.query(`
      CREATE TYPE "TrainingEngineStageLifecycle" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'ENDED_EARLY', 'SKIPPED');
      CREATE TYPE "TrainingEngineProgressStatus" AS ENUM ('NOT_STARTED', 'WORKING', 'STUCK', 'COMPLETED', 'SKIPPED', 'PAUSED', 'FOCUS_OVERRIDE');

      CREATE TABLE "TrainingSessionStage" (
        "id" TEXT PRIMARY KEY,
        "lifecycle" "TrainingEngineStageLifecycle" NOT NULL DEFAULT 'PENDING',
        "endReason" TEXT
      );

      CREATE TABLE "TrainingSessionProblemProgress" (
        "id" TEXT PRIMARY KEY,
        "status" "TrainingEngineProgressStatus" NOT NULL DEFAULT 'NOT_STARTED'
      );

      INSERT INTO "TrainingSessionStage" ("id", "lifecycle", "endReason") VALUES
        ('completed', 'COMPLETED', '正常完成备注'),
        ('early', 'ENDED_EARLY', '教师提前结束备注'),
        ('running', 'RUNNING', NULL);
      INSERT INTO "TrainingSessionProblemProgress" ("id", "status") VALUES
        ('focus', 'FOCUS_OVERRIDE'),
        ('stuck', 'STUCK');
    `)

    const migration = fs.readFileSync(
      path.resolve(process.cwd(), 'prisma/migrations/20260921_training_stage_terminal_lifecycle/migration.sql'),
      'utf8',
    )
    await client.query(migration)
  })

  afterAll(async () => {
    if (!client) return
    try {
      await client.query('SET search_path TO public')
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    } finally {
      await client.end()
    }
  })

  it('collapses historical terminal lifecycles into ENDED with canonical reasons', async () => {
    const result = await client.query(`
      SELECT "id", "lifecycle"::text AS "lifecycle", "endReason"::text AS "endReason", "endNote"
      FROM "TrainingSessionStage"
      ORDER BY "id"
    `)
    expect(result.rows).toEqual([
      { id: 'completed', lifecycle: 'ENDED', endReason: 'SYSTEM_ENDED', endNote: '正常完成备注' },
      { id: 'early', lifecycle: 'ENDED', endReason: 'TEACHER_ENDED_EARLY', endNote: '教师提前结束备注' },
      { id: 'running', lifecycle: 'RUNNING', endReason: null, endNote: null },
    ])
  })

  it('retires FOCUS_OVERRIDE as a persisted progress status', async () => {
    const result = await client.query(`
      SELECT "id", "status"::text AS "status"
      FROM "TrainingSessionProblemProgress"
      ORDER BY "id"
    `)
    expect(result.rows).toEqual([
      { id: 'focus', status: 'WORKING' },
      { id: 'stuck', status: 'STUCK' },
    ])
  })

  it('leaves only canonical enum values after migration', async () => {
    const enums = await client.query(`
      SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = $1
        AND t.typname IN ('TrainingEngineStageLifecycle', 'TrainingEngineProgressStatus', 'TrainingEngineStageEndReason')
      GROUP BY t.typname
      ORDER BY t.typname
    `, [schema])

    const byName = Object.fromEntries(enums.rows.map(row => [row.typname, row.values]))
    expect(byName.TrainingEngineStageLifecycle).toEqual(['PENDING', 'RUNNING', 'ENDED', 'SKIPPED'])
    expect(byName.TrainingEngineProgressStatus).toEqual(['NOT_STARTED', 'WORKING', 'STUCK', 'COMPLETED', 'SKIPPED', 'PAUSED'])
    expect(byName.TrainingEngineStageEndReason).toEqual([
      'TIME_REACHED', 'COMPLETION_REACHED', 'HYBRID_REACHED', 'TEACHER_ENDED',
      'TEACHER_ENDED_EARLY', 'SESSION_ENDED', 'SYSTEM_ENDED',
    ])
  })
})
