import path from 'node:path'
import { defineConfig } from '@playwright/test'

const root = __dirname
const port = 3410
const resultsDir = path.join(root, 'test-results')
const testdataDir = path.join(resultsDir, 'testdata')
const storageRoot = path.join(resultsDir, 'storage')
const databaseUrl = process.env.E2E_DATABASE_URL
  || 'postgresql://oi:oi_password@127.0.0.1:5432/oi_manager?schema=e2e'
const parsedDatabaseUrl = new URL(databaseUrl)
if (parsedDatabaseUrl.searchParams.get('schema') !== 'e2e') {
  throw new Error('Blue/green tests require an explicit schema=e2e database URL')
}
process.env.DATABASE_URL = databaseUrl
process.env.TESTDATA_DIR = testdataDir
process.env.STORAGE_ROOT = storageRoot
export default defineConfig({
  testDir: path.join(root, 'e2e/stress'),
  testMatch: 'blue-green-finalization.spec.ts',
  outputDir: path.join(resultsDir, 'blue-green-playwright'),
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: 'bash scripts/start-isolated-blue-green-stack.sh',
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      JUDGE_TOKEN: 'e2e-blue-green-token-20260827',
      E2E_ACCOUNT_PASSWORD: process.env.E2E_ACCOUNT_PASSWORD || '123456',
      TESTDATA_DIR: testdataDir,
      STORAGE_ROOT: storageRoot,
      PORT: '3412',
      API_HOST: '127.0.0.1',
    },
  },
})
