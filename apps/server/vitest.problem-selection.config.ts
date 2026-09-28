import { defineConfig } from 'vitest/config'

/** No database setup, reset, seed, migration or application bootstrap. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/problem-selection-local.test.ts'],
    setupFiles: [],
  },
})
