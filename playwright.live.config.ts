import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/live',
  testIgnore: process.env.CHAT_PROBE_ENABLED === 'true' ? [] : /chat-probe\.spec\.ts/,
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.E2E_LIVE_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
