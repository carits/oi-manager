import path from 'node:path'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: __dirname,
  testMatch: 'reference.spec.ts',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  workers: 2,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  outputDir: path.resolve(__dirname, '../../test-results/problem-reference/browser'),
  reporter: [['line'], ['html', { outputFolder: path.resolve(__dirname, '../../test-results/problem-reference/report'), open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:3197', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node e2e/problem-reference/server.mjs', cwd: path.resolve(__dirname, '../..'), url: 'http://127.0.0.1:3197', timeout: 60_000, reuseExistingServer: false },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { browserName: 'firefox', viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
})
