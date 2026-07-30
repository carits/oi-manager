import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/live',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_LIVE_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
})
