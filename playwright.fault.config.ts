import path from 'node:path'
import { defineConfig } from '@playwright/test'
import { loadRuntimeSecrets } from './e2e/fixtures/runtime'

const rootDir = __dirname
const resultsDir = path.join(rootDir, 'test-results')
const databaseUrl = process.env.E2E_DATABASE_URL
  || 'postgresql://oi:oi_password@127.0.0.1:15432/oi_manager?schema=e2e'
const parsed = new URL(databaseUrl)
if (parsed.searchParams.get('schema') !== 'e2e' || parsed.port !== '15432') {
  throw new Error('Infrastructure fault tests require dedicated port 15432 and schema=e2e')
}
const runtimeSecrets = loadRuntimeSecrets()
process.env.DATABASE_URL = databaseUrl
process.env.TESTDATA_DIR = path.join(resultsDir, 'testdata')
process.env.STORAGE_ROOT = path.join(resultsDir, 'fault-storage')

export default defineConfig({
  testDir: './e2e/stress', testMatch: 'infrastructure-faults.spec.ts',
  outputDir: path.join(resultsDir, 'fault-playwright'),
  timeout: 4 * 60_000, expect: { timeout: 90_000 }, workers: 1, retries: 0,
  reporter: [['line']],
  use: { baseURL: 'http://127.0.0.1:3512', trace: 'off', screenshot: 'off', video: 'off' },
  webServer: {
    command: 'bash scripts/start-isolated-judge-stack.sh', cwd: rootDir,
    url: 'http://127.0.0.1:3512/api/health', timeout: 120_000, reuseExistingServer: false,
    env: {
      ...process.env,
      NODE_ENV: 'test', APP_ENV: 'development', COOKIE_SECURE: 'false', E2E_BUILD: 'true',
      PORT: '3512', DATABASE_URL: databaseUrl,
      JWT_SECRET: runtimeSecrets.jwtSecret, JUDGE_TOKEN: runtimeSecrets.judgeToken,
      DISABLE_BACKGROUND_JOBS: 'true', ENABLE_MAINTENANCE_API: 'false',
      STORAGE_ROOT: path.join(resultsDir, 'fault-storage'), TESTDATA_DIR: path.join(resultsDir, 'testdata'),
      BACKEND_URL: 'ws://127.0.0.1:3512', SANDBOX_HOST: 'http://127.0.0.1:15052',
      STRESS_GO_JUDGE_PORT: '15053', STRESS_SANDBOX_PROXY_PORT: '15052',
      STRESS_GO_JUDGE_NAME: 'oi-manager-e2e-fault-go-judge',
      STRESS_GO_JUDGE_LABEL: 'oi-manager.e2e-fault=true',
      JUDGE_ID: 'e2e-fault-judge', MAX_CONCURRENT: '1', JUDGE_RESULT_DB_RETRY_MS: '15000',
      CHECKER_INCLUDE_DIR: path.join(rootDir, 'apps/judge/checker-includes'),
    },
  },
})
