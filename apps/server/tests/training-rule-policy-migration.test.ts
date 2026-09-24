import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.DATABASE_URL
const schema = `training_rule_migration_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
let client: Client

describe.skipIf(!databaseUrl)('training canonical rule policy migration', () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl })
    await client.connect()
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}"`)
    await client.query(`
      CREATE TABLE "TrainingSessionStage" ("id" text PRIMARY KEY, "rules" jsonb);
      CREATE TABLE "TrainingSessionStageGroup" ("id" text PRIMARY KEY, "rules" jsonb);
      CREATE TABLE "TrainingSessionStageProblem" ("id" text PRIMARY KEY, "timePolicy" jsonb);
      CREATE TABLE "TrainingSessionStageProblemPlan" ("id" text PRIMARY KEY, "timePolicy" jsonb);
      CREATE TABLE "TrainingSessionTemplateStage" ("id" text PRIMARY KEY, "rules" jsonb);

      INSERT INTO "TrainingSessionStage" VALUES
        ('stage-soft', '{"timePolicy":{"mode":"SOFT","limitSeconds":600}}'),
        ('stage-empty', '{}');
      INSERT INTO "TrainingSessionStageGroup" VALUES
        ('group-hard', '{"timePolicy":{"mode":"HARD","limitSeconds":900}}');
      INSERT INTO "TrainingSessionStageProblem" VALUES
        ('problem-switch', '{"mode":"SWITCH_REQUIRED","limitSeconds":1200}');
      INSERT INTO "TrainingSessionStageProblemPlan" VALUES
        ('plan-recommend', '{"mode":"RECOMMEND_SWITCH","limitSeconds":300}');
      INSERT INTO "TrainingSessionTemplateStage" VALUES
        ('template-soft', '{"timePolicy":{"mode":"SOFT","limitSeconds":480}}');
    `)

    const migration = fs.readFileSync(
      path.resolve(process.cwd(), 'prisma/migrations/20260922_training_rule_policy_canonicalization/migration.sql'),
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

  it('canonicalizes Stage and Group time policies and materializes access scope', async () => {
    const stages = await client.query('SELECT "id", "rules" FROM "TrainingSessionStage" ORDER BY "id"')
    expect(stages.rows).toEqual([
      { id: 'stage-empty', rules: { accessScope: 'CURRENT_STAGE' } },
      { id: 'stage-soft', rules: { accessScope: 'CURRENT_STAGE', timePolicy: { mode: 'REMIND', action: 'REMIND', limitSeconds: 600 } } },
    ])

    const groups = await client.query('SELECT "rules" FROM "TrainingSessionStageGroup" WHERE "id" = $1', ['group-hard'])
    expect(groups.rows[0].rules.timePolicy).toEqual({ mode: 'LOCK_SUBMISSION', action: 'LOCK_SUBMISSION', limitSeconds: 900 })
  })

  it('canonicalizes problem, plan and template time policies', async () => {
    const problem = await client.query('SELECT "timePolicy" FROM "TrainingSessionStageProblem" WHERE "id" = $1', ['problem-switch'])
    expect(problem.rows[0].timePolicy).toEqual({ mode: 'FORCE_SWITCH', action: 'FORCE_SWITCH', limitSeconds: 1200 })

    const plan = await client.query('SELECT "timePolicy" FROM "TrainingSessionStageProblemPlan" WHERE "id" = $1', ['plan-recommend'])
    expect(plan.rows[0].timePolicy).toEqual({ mode: 'RECOMMEND_SWITCH', action: 'RECOMMEND_SWITCH', limitSeconds: 300 })

    const template = await client.query('SELECT "rules" FROM "TrainingSessionTemplateStage" WHERE "id" = $1', ['template-soft'])
    expect(template.rows[0].rules).toEqual({
      accessScope: 'CURRENT_STAGE',
      timePolicy: { mode: 'REMIND', action: 'REMIND', limitSeconds: 480 },
    })
  })
})
