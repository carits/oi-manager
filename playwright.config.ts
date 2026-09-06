import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'
import { loadRuntimeSecrets } from './e2e/fixtures/runtime'

const rootDir = __dirname
const serverDir = path.join(rootDir, 'apps/server')
const webDir = path.join(rootDir, 'apps/web')
const resultsDir = path.join(rootDir, 'test-results')
const databaseUrl =
  process.env.E2E_DATABASE_URL ||
  'postgresql://oi:oi_password@127.0.0.1:5432/oi_manager?schema=e2e'
const runtimeSecrets = loadRuntimeSecrets()
const parsedDatabaseUrl = new URL(databaseUrl)
if (parsedDatabaseUrl.searchParams.get('schema') !== 'e2e') {
  throw new Error('Playwright tests require E2E_DATABASE_URL with schema=e2e')
}
const storageRoot = path.join(resultsDir, 'storage')
const testdataDir = path.join(resultsDir, 'testdata')

// Test files may import server modules directly. Set their process-level
// dependencies before Playwright loads any test module so singleton clients
// can never fall back to the production schema or storage paths.
process.env.DATABASE_URL = databaseUrl
process.env.STORAGE_ROOT = storageRoot
process.env.TESTDATA_DIR = testdataDir

export default defineConfig({
  testDir: './e2e/tests',
  outputDir: path.join(resultsDir, 'playwright'),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ['line'],
    ['html', { outputFolder: path.join(resultsDir, 'playwright-report'), open: 'never' }],
    ['json', { outputFile: path.join(resultsDir, 'playwright-results.json') }],
    [path.join(rootDir, 'e2e/reporters/defect-reporter.ts')],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm exec tsx src/index.ts',
      cwd: serverDir,
      url: 'http://127.0.0.1:3102/api/health',
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        APP_ENV: 'development',
        COOKIE_SECURE: 'false',
        E2E_BUILD: 'true',
        PORT: '3102',
        DATABASE_URL: databaseUrl,
        JWT_SECRET: runtimeSecrets.jwtSecret,
        JUDGE_TOKEN: runtimeSecrets.judgeToken,
        DISABLE_BACKGROUND_JOBS: 'true',
        ENABLE_MAINTENANCE_API: 'false',
        STORAGE_ROOT: storageRoot,
        TESTDATA_DIR: testdataDir,
      },
    },
    {
      command: 'pnpm exec next build && pnpm exec next start -p 3100',
      cwd: webDir,
      url: 'http://127.0.0.1:3100/login',
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        APP_ENV: 'development',
        NEXT_PUBLIC_APP_ENV: 'development',
        BACKEND_URL: 'http://127.0.0.1:3102',
        NEXT_PUBLIC_API_URL: '',
        E2E_BUILD: 'true',
        NEXT_DIST_DIR: '.next-e2e',
      },
    },
  ],
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium-desktop',
      dependencies: ['setup'],
      testIgnore: /live\//,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'chromium-compact',
      dependencies: ['setup'],
      grep: /@compact/,
      testIgnore: /live\//,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'firefox-smoke',
      dependencies: ['setup'],
      grep: /@smoke/,
      testIgnore: /live\//,
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'firefox-chat',
      dependencies: ['setup'],
      testMatch: /direct-chat-flow\.spec\.ts/,
      grep: /@chat-release/,
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
})
