import { beforeEach, describe, expect, it, vi } from 'vitest'

const compileMock = vi.hoisted(() => vi.fn())
vi.mock('./sandbox/client', () => ({
  isLocalMode: () => false,
  compile: compileMock,
  deleteFile: vi.fn(async () => {}),
  execute: vi.fn(),
  runCommand: vi.fn(),
  runPiped: vi.fn(),
}))

import { judge } from './judge'

const request = {
  submissionId: '1',
  problemId: 'fault-test',
  language: 'cpp17',
  code: 'int main(){}',
  testdataPath: '.',
  config: { mode: 'acm' as const, type: 'default' as const, cases: [{ input: '1.in', output: '1.out' }] },
}

describe('sandbox infrastructure classification', () => {
  beforeEach(() => compileMock.mockReset())

  it('marks a transport failure retryable instead of scoring it as user CE', async () => {
    compileMock.mockResolvedValue({ success: false, error: 'connect ECONNRESET', infrastructureError: true })
    await expect(judge(request)).resolves.toMatchObject({ result: 'System Error', retryable: true })
  })

  it('keeps a real compiler diagnostic as a terminal compilation error', async () => {
    compileMock.mockResolvedValue({ success: false, error: 'main.cpp: syntax error' })
    await expect(judge(request)).resolves.toMatchObject({ result: 'Compilation Error' })
    expect((await judge(request)).retryable).not.toBe(true)
  })
})
