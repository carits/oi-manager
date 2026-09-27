import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'

const databaseUrl = process.env.DATABASE_URL
const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'prisma/migrations/20260927_training_global_stage_model/migration.sql'),
  'utf8',
)

async function withSchema<T>(prefix: string, run: (client: Client) => Promise<T>) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  const schema = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}"`)
    return await run(client)
  } finally {
    await client.query('SET search_path TO public').catch(() => undefined)
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined)
    await client.end()
  }
}

async function createLegacySchema(client: Client) {
  await client.query(`
    CREATE TYPE "TrainingEngineStageAccessPolicy" AS ENUM ('ALL_AT_ONCE', 'SEQUENTIAL', 'TEACHER_CONTROLLED');
    CREATE TYPE "TrainingEngineSubmissionMode" AS ENUM ('ENABLED', 'DISABLED');
    CREATE TYPE "TrainingEngineStageLifecycle" AS ENUM ('PENDING', 'RUNNING', 'ENDED', 'SKIPPED');
    CREATE TYPE "TrainingEngineStageEndReason" AS ENUM ('TIME_REACHED', 'COMPLETION_REACHED', 'HYBRID_REACHED', 'TEACHER_ENDED', 'TEACHER_ENDED_EARLY', 'SESSION_ENDED', 'SYSTEM_ENDED');
    CREATE TYPE "TrainingEngineStageEndPolicy" AS ENUM ('MANUAL', 'TIME', 'COMPLETION', 'HYBRID');
    CREATE TYPE "TrainingEngineGroupChangeEffectiveMode" AS ENUM ('IMMEDIATE', 'NEXT_STAGE');

    CREATE TABLE "TrainingSession" (
      "id" text PRIMARY KEY,
      "status" text NOT NULL
    );
    CREATE TABLE "TrainingSessionStage" (
      "id" text PRIMARY KEY,
      "sessionId" text NOT NULL REFERENCES "TrainingSession"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "orderIndex" integer NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "TrainingSessionGroup" (
      "id" text PRIMARY KEY,
      "sessionId" text NOT NULL REFERENCES "TrainingSession"("id") ON DELETE CASCADE,
      "orderIndex" integer NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "TrainingSessionStageGroup" (
      "id" text PRIMARY KEY,
      "stageId" text NOT NULL REFERENCES "TrainingSessionStage"("id") ON DELETE CASCADE,
      "groupId" text NOT NULL REFERENCES "TrainingSessionGroup"("id") ON DELETE CASCADE,
      "mode" text NOT NULL DEFAULT 'PRACTICE',
      "accessPolicy" "TrainingEngineStageAccessPolicy" NOT NULL DEFAULT 'ALL_AT_ONCE',
      "submissionMode" "TrainingEngineSubmissionMode" NOT NULL DEFAULT 'ENABLED',
      "plannedDurationSeconds" integer,
      "minDurationSeconds" integer,
      "completionThreshold" integer,
      "completionPolicy" jsonb,
      "rules" jsonb,
      "transitionPolicy" text NOT NULL DEFAULT 'WAIT_FOR_TEACHER',
      "status" "TrainingEngineStageLifecycle" NOT NULL DEFAULT 'PENDING',
      "startedAt" timestamp(3),
      "runningSince" timestamp(3),
      "activeElapsedSeconds" integer NOT NULL DEFAULT 0,
      "endedAt" timestamp(3),
      "endReason" text,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX "TrainingSessionStageGroup_one_active_unit_per_group_key"
      ON "TrainingSessionStageGroup"("groupId") WHERE "status" = 'RUNNING';
    CREATE INDEX "TrainingSessionStageGroup_stageId_status_idx" ON "TrainingSessionStageGroup"("stageId", "status");
    CREATE INDEX "TrainingSessionStageGroup_groupId_status_idx" ON "TrainingSessionStageGroup"("groupId", "status");

    CREATE TABLE "TrainingSessionStageProblem" (
      "id" text PRIMARY KEY,
      "stageId" text NOT NULL REFERENCES "TrainingSessionStage"("id") ON DELETE CASCADE,
      "orderIndex" integer NOT NULL,
      "unlockPolicy" jsonb,
      "targetScore" integer,
      "scoreGoals" jsonb,
      "timePolicy" jsonb,
      "stuckPolicy" jsonb,
      "hintPolicy" jsonb,
      "allowedSubtaskIds" jsonb,
      "judgeConfigProjection" text,
      "strategyIntervalSeconds" integer
    );
    CREATE TABLE "TrainingSessionStageProblemPlan" (
      "id" text PRIMARY KEY,
      "stageId" text NOT NULL REFERENCES "TrainingSessionStage"("id") ON DELETE CASCADE,
      "stageProblemId" text NOT NULL REFERENCES "TrainingSessionStageProblem"("id") ON DELETE CASCADE,
      "stageGroupId" text NOT NULL REFERENCES "TrainingSessionStageGroup"("id") ON DELETE CASCADE,
      "orderIndex" integer NOT NULL,
      "unlockPolicy" jsonb,
      "targetScore" integer,
      "scoreGoals" jsonb,
      "timePolicy" jsonb,
      "stuckPolicy" jsonb,
      "hintPolicy" jsonb,
      "allowedSubtaskIds" jsonb,
      "judgeConfigProjection" text,
      "strategyIntervalSeconds" integer,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "TrainingSessionGroupChange" (
      "id" text PRIMARY KEY,
      "sessionId" text NOT NULL REFERENCES "TrainingSession"("id") ON DELETE CASCADE,
      "effectiveAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "TrainingSessionStageParticipantAssignment" (
      "id" text PRIMARY KEY
    );
  `)
}

describe.skipIf(!databaseUrl)('Training global Stage migration', () => {
  it('moves runtime state to Stage and preserves default and override plans', async () => {
    await withSchema('training_global_stage', async client => {
      await createLegacySchema(client)
      await client.query(`
        INSERT INTO "TrainingSession" VALUES ('session-1', 'DRAFT');
        INSERT INTO "TrainingSessionStage" ("id", "sessionId", "name", "orderIndex")
          VALUES ('stage-1', 'session-1', '热身', 0);
        INSERT INTO "TrainingSessionGroup" ("id", "sessionId", "orderIndex")
          VALUES ('group-1', 'session-1', 0), ('group-2', 'session-1', 1);
        INSERT INTO "TrainingSessionStageGroup"
          ("id", "stageId", "groupId", "mode", "accessPolicy", "submissionMode", "status")
          VALUES
            ('plan-1', 'stage-1', 'group-1', 'GUIDED', 'SEQUENTIAL', 'ENABLED', 'PENDING'),
            ('plan-2', 'stage-1', 'group-2', 'GUIDED', 'ALL_AT_ONCE', 'DISABLED', 'PENDING');
        INSERT INTO "TrainingSessionStageProblem"
          ("id", "stageId", "orderIndex", "targetScore")
          VALUES ('problem-1', 'stage-1', 0, 60);
        INSERT INTO "TrainingSessionStageProblemPlan"
          ("id", "stageId", "stageProblemId", "stageGroupId", "orderIndex", "targetScore")
          VALUES
            ('problem-plan-1', 'stage-1', 'problem-1', 'plan-1', 0, 60),
            ('problem-plan-2', 'stage-1', 'problem-1', 'plan-2', 0, 80);
      `)

      await client.query(migration)

      const stage = await client.query('SELECT "mode", "accessPolicy"::text AS "accessPolicy", lifecycle::text FROM "TrainingSessionStage"')
      expect(stage.rows).toEqual([{ mode: 'GUIDED', accessPolicy: 'SEQUENTIAL', lifecycle: 'PENDING' }])

      const plans = await client.query('SELECT id, "groupId", "isDefault", "inheritsDefault" FROM "TrainingSessionStageGroup" ORDER BY id')
      expect(plans.rows).toEqual([
        { id: 'plan-1', groupId: null, isDefault: true, inheritsDefault: false },
        { id: 'plan-2', groupId: 'group-2', isDefault: false, inheritsDefault: true },
      ])

      const problemPlans = await client.query('SELECT id, required FROM "TrainingSessionStageProblemPlan" ORDER BY id')
      expect(problemPlans.rows).toEqual([
        { id: 'problem-plan-1', required: true },
        { id: 'problem-plan-2', required: true },
      ])

      const removedTable = await client.query(`
        SELECT to_regclass(current_schema() || '."TrainingSessionStageParticipantAssignment"') AS name
      `)
      expect(removedTable.rows[0].name).toBeNull()

      const oldColumns = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'TrainingSessionStageGroup'
          AND column_name IN ('status', 'startedAt', 'runningSince', 'activeElapsedSeconds', 'endedAt', 'endReason')
      `)
      expect(oldColumns.rows).toHaveLength(0)
    })
  })

  it('fails closed when a per-group runtime has started', async () => {
    await withSchema('training_global_stage_guard', async client => {
      await createLegacySchema(client)
      await client.query(`
        INSERT INTO "TrainingSession" VALUES ('session-1', 'RUNNING');
        INSERT INTO "TrainingSessionStage" ("id", "sessionId", "name", "orderIndex")
          VALUES ('stage-1', 'session-1', '运行中', 0);
        INSERT INTO "TrainingSessionGroup" ("id", "sessionId", "orderIndex")
          VALUES ('group-1', 'session-1', 0);
        INSERT INTO "TrainingSessionStageGroup"
          ("id", "stageId", "groupId", "status")
          VALUES ('plan-1', 'stage-1', 'group-1', 'RUNNING');
      `)
      await expect(client.query(migration)).rejects.toThrow(/TRAINING_GLOBAL_STAGE_MIGRATION_ACTIVE_RUNTIME_FOUND/)
      await client.query('ROLLBACK')
      const columns = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'TrainingSession'
          AND column_name = 'currentStageId'
      `)
      expect(columns.rows).toHaveLength(0)
    })
  })
})
