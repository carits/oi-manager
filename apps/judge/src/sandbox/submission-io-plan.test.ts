import { describe, expect, it } from 'vitest'
import { buildSubmissionIoSandboxPlan } from './client'

describe('go-judge submission IO plan', () => {
  it.each([
    [null, null, 'payload', 'payload', ['stdout', 'stderr']],
    ['travel.in', null, '', 'payload', ['stdout', 'stderr']],
    [null, 'travel.out', 'payload', undefined, ['stdout', 'stderr', 'travel.out']],
    ['travel.in', 'travel.out', '', 'payload', ['stdout', 'stderr', 'travel.out']],
  ] as const)('builds isolated mapping for input=%s output=%s', (inputFile, outputFile, stdinContent, fileContent, copyOutFiles) => {
    const plan = buildSubmissionIoSandboxPlan({ execute: './main', testcaseInput: 'payload', inputFile, outputFile })
    expect(plan.copyIn.stdin.content).toBe(stdinContent)
    if (inputFile) expect(plan.copyIn[inputFile].content).toBe(fileContent)
    expect(plan.copyOutFiles).toEqual(copyOutFiles)
    expect(plan.execCommand).toContain('<stdin >stdout 2>stderr')
  })
})
