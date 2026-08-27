import { describe, expect, it, vi } from 'vitest'

const acquireMock = vi.hoisted(() => vi.fn())
vi.mock('./compiled-program-cache', () => ({ acquireCompiledProgram: acquireMock }))
vi.mock('./sandbox/client', () => ({ execute: vi.fn() }))

import { judgeHack } from './hack'

describe('Hack infrastructure retry', () => {
  it('requeues a Validator compile transport failure instead of finalizing system_error', async () => {
    const error = Object.assign(new Error('connect ECONNRESET'), { infrastructureError: true })
    acquireMock.mockRejectedValueOnce(error)
    const result = await judgeHack({
      taskType: 'hack', hackAttemptId: 'fault-hack', problemId: 'problem', testdataPath: '.',
      config: { mode: 'acm', type: 'default', cases: [] },
      judgeConfigHash: 'hash', hackConfigRevision: 1, inputMode: 'data', inputData: '1 2\n',
      hackSource: 'int main(){}', hackLanguage: 'cpp17',
      standardSource: 'int main(){}', validatorSource: 'int main(){}',
    })
    expect(result).toMatchObject({ outcome: 'system_error', failureStage: 'validator', retryable: true })
  })
})
