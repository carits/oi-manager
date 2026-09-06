import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { Client } from 'pg'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '../../../..')
const envPath = path.join(rootDir, 'e2e/.env')

dotenv.config({ path: envPath })

const databaseUrl =
  process.env.E2E_DATABASE_URL ||
  'postgresql://oi:oi_password@127.0.0.1:5432/oi_manager?schema=e2e'
const parsedUrl = new URL(databaseUrl)

if (parsedUrl.searchParams.get('schema') !== 'e2e') {
  throw new Error('Refusing to reset a database without the explicit schema=e2e guard')
}

const adminUrl = new URL(databaseUrl)
adminUrl.searchParams.delete('schema')
const testdataRoot = path.join(rootDir, 'test-results/testdata')
const runtimeSecrets = {
  accountPassword: randomBytes(24).toString('base64url'),
  jwtSecret: randomBytes(32).toString('base64url'),
  judgeToken: randomBytes(32).toString('base64url'),
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    cwd: path.join(rootDir, 'apps/server'),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'test',
      E2E_ACCOUNT_PASSWORD: runtimeSecrets.accountPassword,
      JWT_SECRET: runtimeSecrets.jwtSecret,
      JUDGE_TOKEN: runtimeSecrets.judgeToken,
      DISABLE_BACKGROUND_JOBS: 'true',
      STORAGE_ROOT: path.join(rootDir, 'test-results/storage'),
      TESTDATA_DIR: testdataRoot,
    },
    encoding: 'utf8',
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`)
  }
}

async function main() {
  const client = new Client({ connectionString: adminUrl.toString() })
  await client.connect()
  try {
    await client.query('DROP SCHEMA IF EXISTS e2e CASCADE')
    await client.query('CREATE SCHEMA e2e')
  } finally {
    await client.end()
  }

  fs.rmSync(path.join(rootDir, 'test-results/storage'), { recursive: true, force: true })
  fs.mkdirSync(path.join(rootDir, 'test-results/storage'), { recursive: true })
  fs.rmSync(testdataRoot, { recursive: true, force: true })
  fs.mkdirSync(testdataRoot, { recursive: true })
  fs.writeFileSync(
    path.join(rootDir, 'test-results/e2e-runtime.json'),
    `${JSON.stringify(runtimeSecrets, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )

  // E2E preparation must remain self-contained after schema changes. A stale
  // generated client can successfully push the database and then fail while
  // seeding newly added models.
  run('pnpm', ['exec', 'prisma', 'generate'])
  run('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate'])
  run('pnpm', ['exec', 'tsx', 'scripts/e2e/seed.ts'])
  run('pnpm', ['exec', 'tsx', 'scripts/e2e/write-fixtures.ts'])
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
