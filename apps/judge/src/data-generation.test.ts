import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateTestdata } from './data-generation'
import { acquireCompiledProgram } from './compiled-program-cache'
import { execute } from './sandbox/client'
import { judge } from './judge'

vi.mock('./compiled-program-cache', () => ({ acquireCompiledProgram: vi.fn() }))
vi.mock('./sandbox/client', () => ({ execute: vi.fn() }))
vi.mock('./judge', () => ({ judge: vi.fn() }))

const lease = { result: { success: true, fileId: 'compiled' }, release: vi.fn(async () => undefined) }
const request = {
  taskType: 'data_generation' as const, jobId: 'job-1', problemId: 'problem-1', fencingToken: 'fence-1',
  sourceMode: 'input' as const, problemConfig: { mode: 'acm' as const, checker_type: 'default' },
  standard: { language: 'cpp17' as const, source: 'std' }, validator: { language: 'cpp17' as const, source: 'validator' },
  cases: [{ id: 'case-1', name: 'manual', args: [], inputData: '1 2\n' }],
}

describe('data generation task', () => {
  beforeEach(() => {
    vi.mocked(acquireCompiledProgram).mockReset().mockResolvedValue(lease as any)
    vi.mocked(execute).mockReset()
    vi.mocked(judge).mockReset()
  })

  it('stops a case when Validator rejects input', async () => {
    vi.mocked(execute).mockResolvedValueOnce({ status: 'Runtime Error', time: 1, memory: 1, exitCode: 3 })
    const result = await generateTestdata(request)
    expect(result.cases[0]).toMatchObject({ status: 'failed', failureStage: 'validator' })
    expect(judge).not.toHaveBeenCalled()
  })

  it('returns a candidate after Validator, STD and Checker self-check pass', async () => {
    vi.mocked(execute)
      .mockResolvedValueOnce({ status: 'Accepted', time: 1, memory: 1, exitCode: 0 })
      .mockResolvedValueOnce({ status: 'Accepted', time: 2, memory: 1, exitCode: 0, stdout: '3\n' })
    vi.mocked(judge).mockResolvedValue({ submissionId: 'self', result: 'Accepted', time: 1, memory: 1, score: 100, cases: [] })
    const result = await generateTestdata(request)
    expect(result.cases[0]).toMatchObject({ status: 'validated', inputData: '1 2\n', outputData: '3\n' })
  })
})
