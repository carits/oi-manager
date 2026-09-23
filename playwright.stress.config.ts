import path from 'node:path'
import { defineConfig } from '@playwright/test'
import { loadRuntimeSecrets } from './e2e/fixtures/runtime'

const rootDir = __dirname
const resultsDir = path.join(rootDir, 'test-results')
const databaseUrl = process.env.E2E_DATABASE_URL
  || 'postgresql://oi:oi_password@127.0.0.1:5432/oi_manager?schema=e2e'
const parsedDatabaseUrl = new URL(databaseUrl)
if (parsedDatabaseUrl.searchParams.get('schema') !== 'e2e') {
  throw new Error('Stress tests require an explicit schema=e2e database URL')
}
const runtimeSecrets = loadRuntimeSecrets()

export default defineConfig({
  testDir: './e2e/stress',
  outputDir: path.join(resultsDir, 'stress-playwright'),
  timeout: 15 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:3112',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'bash scripts/start-isolated-judge-stack.sh',
    cwd: rootDir,
    url: 'http://127.0.0.1:3112/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      APP_ENV: 'development',
      COOKIE_SECURE: 'false',
      E2E_BUILD: 'true',
      PORT: '3112',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: runtimeSecrets.jwtSecret,
      JUDGE_TOKEN: runtimeSecrets.judgeToken,
      DISABLE_BACKGROUND_JOBS: 'true',
      STORAGE_ROOT: path.join(resultsDir, 'stress-storage'),
      TESTDATA_DIR: path.join(resultsDir, 'testdata'),
      BACKEND_URL: 'ws://127.0.0.1:3112',
      SANDBOX_HOST: 'http://127.0.0.1:15050',
      JUDGE_ID: 'e2e-stress-judge',
      MAX_CONCURRENT: process.env.E2E_STRESS_JUDGE_CONCURRENCY || '4',
      JUDGE_TIMEOUT: '60000',
      CHECKER_INCLUDE_DIR: path.join(rootDir, 'apps/judge/checker-includes'),
    },
  },
})
