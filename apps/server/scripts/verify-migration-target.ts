import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseName = process.env.MIGRATION_DATABASE_NAME_OVERRIDE
if (!databaseName || !/^oi_manager_(?:migration|path)_audit_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error('MIGRATION_DATABASE_NAME_OVERRIDE must name an isolated migration/path audit database')
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const url = new URL(process.env.DATABASE_URL)
url.pathname = `/${databaseName}`
process.env.DATABASE_URL = url.toString()

function redact(value: string) {
  return value.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://***@')
}

function prisma(args: string[]) {
  const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', 'prisma', ...args], {
    cwd: serverRoot, env: process.env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(redact(`${result.stderr || ''}\n${result.stdout || ''}`.trim()).slice(-6000))
}

async function main() {
  prisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma'])
  prisma(['migrate', 'status', '--schema', 'prisma/schema.prisma'])
  const client = new PrismaClient()
  try {
    const [tables, migrations, users] = await Promise.all([
      client.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM pg_tables WHERE schemaname = 'public'`),
      client.$queryRawUnsafe<Array<{ count: bigint }>>('SELECT count(*) AS count FROM public."_prisma_migrations"'),
      client.user.count(),
    ])
    console.log(JSON.stringify({
      database: databaseName, migrateDeployVerified: true,
      tableCount: Number(tables[0].count), migrationRows: Number(migrations[0].count), userCount: users,
    }))
  } finally {
    await client.$disconnect()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? redact(error.message) : String(error))
  process.exit(1)
})
