import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/assignment-grading.test.ts',
      'tests/solution-similarity.test.ts',
      'tests/contest-scoring-rules.test.ts',
    ],
  },
})
