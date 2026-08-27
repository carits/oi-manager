import path from 'node:path'
import { defineConfig } from '@playwright/test'
import { loadRuntimeSecrets } from './e2e/fixtures/runtime'

const rootDir = __dirname
const resultsDir = path.join(rootDir, 'test-results', 'restore-audit')
const databaseUrl = process.env.E2E_DATABASE_URL
const restoredDatabaseUrl = process.env.RESTORED_DATABASE_URL

if (!databaseUrl || !restoredDatabaseUrl) {
  throw new Error('E2E_DATABASE_URL and RESTORED_DATABASE_URL are required')
}

const e2eUrl = new URL(databaseUrl)
const restoredUrl = new URL(restoredDatabaseUrl)
if (e2eUrl.port !== '15435' || e2eUrl.searchParams.get('schema') !== 'e2e') {
  throw new Error('Restore audit writes require dedicated port 15435 and schema=e2e')
}
if (restoredUrl.port !== '15435' || restoredUrl.searchParams.get('schema') !== 'public') {
  throw new Error('Restored production data must be read from port 15435 and schema=public')
}

const runtimeSecrets = loadRuntimeSecrets()
process.env.DATABASE_URL = databaseUrl
process.env.TESTDATA_DIR = path.join(rootDir, 'test-results', 'testdata')
process.env.STORAGE_ROOT = path.join(resultsDir, 'storage')

export default defineConfig({
  testDir: './e2e/stress',
  testMatch: 'restored-backup-core.spec.ts',
  outputDir: path.join(resultsDir, 'playwright'),
  timeout: 5 * 60_000,
  expect: { timeout: 120_000 },
  workers: 1,
  retries: 0,
  reporter: [
    ['line'],
    ['json', { outputFile: path.join(resultsDir, 'playwright-results.json') }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3612',
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'bash scripts/start-isolated-judge-stack.sh',
    cwd: rootDir,
    url: 'http://127.0.0.1:3612/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      APP_ENV: 'development',
      COOKIE_SECURE: 'false',
      E2E_BUILD: 'true',
      PORT: '3612',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: runtimeSecrets.jwtSecret,
      JUDGE_TOKEN: runtimeSecrets.judgeToken,
      DISABLE_BACKGROUND_JOBS: 'true',
      ENABLE_MAINTENANCE_API: 'false',
      STORAGE_ROOT: path.join(resultsDir, 'storage'),
      TESTDATA_DIR: path.join(rootDir, 'test-results', 'testdata'),
      BACKEND_URL: 'ws://127.0.0.1:3612',
      SANDBOX_HOST: 'http://127.0.0.1:15054',
      STRESS_GO_JUDGE_PORT: '15054',
      STRESS_GO_JUDGE_NAME: 'oi-manager-e2e-restore-go-judge',
      STRESS_GO_JUDGE_LABEL: 'oi-manager.restore-audit=true',
      STRESS_RESULTS_DIR: resultsDir,
      JUDGE_ID: 'restore-audit-judge',
      MAX_CONCURRENT: '1',
      CHECKER_INCLUDE_DIR: path.join(rootDir, 'apps/judge/checker-includes'),
    },
  },
})
