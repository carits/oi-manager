import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const apply = process.argv.includes('--apply')
const seed = process.argv.includes('--seed')
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsRoot = path.join(serverRoot, 'prisma/migrations')
const baselinesRoot = path.join(serverRoot, 'prisma/baselines')
const baselinePointerPath = path.join(baselinesRoot, 'current.json')

type MigrationFile = { name: string; file: string; checksum: string }
type BaselineManifest = {
  schemaVersion: number
  epoch: string
  latestMigration: string
  migrationCount: number
  migrations: Array<{ name: string; checksum: string }>
  snapshotSha256: string
}

function redact(value: string) {
  return value.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://***@')
}

function runPrisma(args: string[], input?: string) {
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(executable, ['exec', 'prisma', ...args], {
    cwd: serverRoot,
    env: process.env,
    input,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (result.status !== 0) {
    const detail = redact(`${result.stderr || ''}\n${result.stdout || ''}`.trim()).slice(-6000)
    throw new Error(`Prisma command failed (${args.join(' ')}): ${detail}`)
  }
  return result.stdout
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function resolveMigrations() {
  return fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^[A-Za-z0-9_]+$/.test(entry.name))
    .map(entry => ({ name: entry.name, file: path.join(migrationsRoot, entry.name, 'migration.sql') }))
    .filter(entry => fs.existsSync(entry.file))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => ({
      ...entry,
      checksum: crypto.createHash('sha256').update(fs.readFileSync(entry.file)).digest('hex'),
    }))
}

function resolveBaseline(migrations: MigrationFile[]) {
  if (!fs.existsSync(baselinePointerPath)) throw new Error('Missing current database baseline pointer')
  const pointer = JSON.parse(fs.readFileSync(baselinePointerPath, 'utf8')) as { schemaVersion?: number; epoch?: string }
  if (pointer.schemaVersion !== 1 || !/^\d{8}_[a-z0-9_]+$/.test(pointer.epoch || '')) throw new Error('Invalid current database baseline pointer')
  const baselineRoot = path.join(baselinesRoot, pointer.epoch!)
  const manifestPath = path.join(baselineRoot, 'manifest.json')
  const snapshotPath = path.join(baselineRoot, 'schema.sql')
  if (!fs.existsSync(manifestPath) || !fs.existsSync(snapshotPath)) throw new Error(`Incomplete database baseline ${pointer.epoch}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BaselineManifest
  const snapshotSql = fs.readFileSync(snapshotPath, 'utf8')
  if (manifest.schemaVersion !== 1 || manifest.epoch !== pointer.epoch) throw new Error('Database baseline identity mismatch')
  if (manifest.migrations.length !== manifest.migrationCount || manifest.migrations.at(-1)?.name !== manifest.latestMigration) {
    throw new Error('Database baseline migration manifest is inconsistent')
  }
  const actualSnapshotHash = crypto.createHash('sha256').update(snapshotSql).digest('hex')
  if (actualSnapshotHash !== manifest.snapshotSha256) throw new Error('Database baseline snapshot checksum mismatch')
  const byName = new Map(migrations.map(migration => [migration.name, migration]))
  for (const migration of manifest.migrations) {
    const current = byName.get(migration.name)
    if (!current) throw new Error(`Baseline migration is missing: ${migration.name}`)
    if (current.checksum !== migration.checksum) throw new Error(`Historical migration checksum changed: ${migration.name}`)
  }
  const baselineNames = new Set(manifest.migrations.map(migration => migration.name))
  const futureMigrations = migrations.filter(migration => !baselineNames.has(migration.name))
  for (const migration of futureMigrations) {
    if (migration.name.localeCompare(manifest.latestMigration) <= 0) {
      throw new Error(`Post-baseline migration must sort after ${manifest.latestMigration}: ${migration.name}`)
    }
  }
  return { manifest, snapshotSql, futureMigrations }
}

async function assertEmptyDatabase(prisma: PrismaClient) {
  const objects = await prisma.$queryRawUnsafe<Array<{ name: string; kind: string }>>(`
    SELECT c.relname AS name, c.relkind::text AS kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND c.relname <> '_prisma_migrations'
    ORDER BY c.relname
  `)
  const enums = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`
    SELECT t.typname AS name
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
    ORDER BY t.typname
  `)
  const migrationTable = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(`
    SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists
  `)
  let migrationRows = 0
  if (migrationTable[0]?.exists) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>('SELECT count(*) AS count FROM public."_prisma_migrations"')
    migrationRows = Number(rows[0]?.count || 0)
  }
  if (objects.length || enums.length || migrationRows) {
    throw new Error(`Refusing clean bootstrap: database is not empty (objects=${objects.length}, enums=${enums.length}, migrationRows=${migrationRows})`)
  }
}

async function main() {
  const originalUrl = process.env.DATABASE_URL
  if (!originalUrl) throw new Error('DATABASE_URL is required')
  const databaseNameOverride = process.env.BOOTSTRAP_DATABASE_NAME_OVERRIDE
  if (databaseNameOverride) {
    if (!/^oi_manager_[a-z0-9_]+$/.test(databaseNameOverride)) throw new Error('Unsafe BOOTSTRAP_DATABASE_NAME_OVERRIDE')
    const url = new URL(originalUrl)
    url.pathname = `/${databaseNameOverride}`
    process.env.DATABASE_URL = url.toString()
  }

  const target = new URL(process.env.DATABASE_URL!)
  const databaseName = target.pathname.replace(/^\//, '')
  const prisma = new PrismaClient()
  try {
    await assertEmptyDatabase(prisma)
    const migrations = resolveMigrations()
    if (!migrations.length) throw new Error('No migration files found')
    const baseline = resolveBaseline(migrations)
    if (!baseline.snapshotSql.includes('CREATE TABLE')) throw new Error('Database baseline snapshot is unexpectedly empty')

    if (!apply) {
      console.log(JSON.stringify({
        mode: 'check', database: databaseName, empty: true,
        baselineEpoch: baseline.manifest.epoch,
        baselineMigrationCount: baseline.manifest.migrationCount,
        postBaselineMigrationCount: baseline.futureMigrations.length,
        migrationCount: migrations.length,
        snapshotSha256: baseline.manifest.snapshotSha256,
        ready: true,
      }, null, 2))
      return
    }

    const migrationRows = baseline.manifest.migrations.map(migration => `(
      ${sqlLiteral(crypto.randomUUID())}, ${sqlLiteral(migration.checksum)}, CURRENT_TIMESTAMP,
      ${sqlLiteral(migration.name)}, NULL, NULL, CURRENT_TIMESTAMP, 1
    )`).join(',\n')
    const transactionSql = `
BEGIN;
SELECT pg_advisory_xact_lock(7832357088724);
DO $bootstrap$
DECLARE
  object_count integer;
  enum_count integer;
  migration_count integer := 0;
BEGIN
  SELECT count(*) INTO object_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    AND c.relname <> '_prisma_migrations';
  SELECT count(*) INTO enum_count
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typtype = 'e';
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public."_prisma_migrations"' INTO migration_count;
  END IF;
  IF object_count <> 0 OR enum_count <> 0 OR migration_count <> 0 THEN
    RAISE EXCEPTION 'clean bootstrap target is no longer empty';
  END IF;
END
$bootstrap$;

${baseline.snapshotSql}

CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "_prisma_migrations" (
  "id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count"
) VALUES
${migrationRows};
COMMIT;
`
    runPrisma(['db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'], transactionSql)
    runPrisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma'])
    runPrisma(['migrate', 'status', '--schema', 'prisma/schema.prisma'])
    if (seed) runPrisma(['db', 'seed', '--schema', 'prisma/schema.prisma'])

    const migrationCount = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>('SELECT count(*) AS count FROM public."_prisma_migrations"')
    const tableCount = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM pg_tables WHERE schemaname = 'public'`)
    if (Number(migrationCount[0].count) !== migrations.length) throw new Error('Migration count does not match repository after baseline bootstrap')
    console.log(JSON.stringify({
      mode: 'apply', database: databaseName, baselineEpoch: baseline.manifest.epoch,
      baselineMigrationCount: baseline.manifest.migrationCount,
      postBaselineMigrationCount: baseline.futureMigrations.length,
      migrationCount: Number(migrationCount[0].count),
      tableCount: Number(tableCount[0].count), seeded: seed, migrateDeployVerified: true,
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? redact(error.message) : String(error))
  process.exit(1)
})
