import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'

const databaseUrl = process.env.DATABASE_URL
const migration = fs.readFileSync(
  path.resolve(process.cwd(), 'prisma/migrations/20260922_training_retire_fake_options/migration.sql'),
  'utf8',
)

async function withSchema<T>(prefix: string, run: (client: Client, schema: string) => Promise<T>) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required')
  const schema = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}"`)
    return await run(client, schema)
  } finally {
    await client.query('SET search_path TO public').catch(() => undefined)
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined)
    await client.end()
  }
}

describe.skipIf(!databaseUrl)('retired TrainingSession fake option migration', () => {
  it('drops unused solution/discussion columns when no historical row enabled them', async () => {
    await withSchema('training_fake_options_safe', async (client, schema) => {
      await client.query(`
        CREATE TABLE "TrainingSession" (
          "id" text PRIMARY KEY,
          "allowSolution" boolean NOT NULL DEFAULT false,
          "allowDiscussion" boolean NOT NULL DEFAULT false
        );
        INSERT INTO "TrainingSession" ("id") VALUES ('safe');
      `)
      await client.query(migration)

      const columns = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'TrainingSession'
        ORDER BY column_name
      `, [schema])
      expect(columns.rows.map(row => row.column_name)).toEqual(['id'])
    })
  })

  it('fails closed instead of discarding an enabled historical option', async () => {
    await withSchema('training_fake_options_guard', async client => {
      await client.query(`
        CREATE TABLE "TrainingSession" (
          "id" text PRIMARY KEY,
          "allowSolution" boolean NOT NULL DEFAULT false,
          "allowDiscussion" boolean NOT NULL DEFAULT false
        );
        INSERT INTO "TrainingSession" ("id", "allowSolution") VALUES ('unsafe', true);
      `)

      await expect(client.query(migration)).rejects.toThrow(/enabled historical rows exist/)
      const columns = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'TrainingSession'
        ORDER BY column_name
      `)
      expect(columns.rows.map(row => row.column_name)).toEqual(['allowDiscussion', 'allowSolution', 'id'])
    })
  })
})
