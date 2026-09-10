import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('local Judge result write boundary', () => {
  it('does not write execution result projections back to Submission', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../src/modules/judge/application/judge-run.service.ts'), 'utf8')
    expect(source).not.toContain('clearedSubmissionProjection')
    expect(source).not.toMatch(/tx\.submission\.update\([\s\S]{0,500}(?:result|score|cases|subtasks|timeUsed|memoryUsed)\s*:/)
    expect(source).not.toContain('submission.result =')
  })
})
