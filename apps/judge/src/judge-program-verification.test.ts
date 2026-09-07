import { beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyJudgeProgram } from './judge-program-verification'
import { acquireCompiledProgram } from './compiled-program-cache'
import { runValidatorProgram } from './judge-program-runner'

vi.mock('./compiled-program-cache', () => ({ acquireCompiledProgram: vi.fn() }))
vi.mock('./judge-program-runner', () => ({
  runClassifierProgram: vi.fn(),
  runGeneratorProgram: vi.fn(),
  runStandardProgram: vi.fn(),
  runValidatorProgram: vi.fn(),
}))
vi.mock('./judge', () => ({ judge: vi.fn() }))

const release = vi.fn(async () => undefined)
const baseRequest = {
  taskType: 'judge_program_verification' as const,
  jobId: 'verify-1',
  problemId: 'problem-1',
  programId: 'program-1',
  versionId: 'version-1',
  fixtureSetId: 'fixture-set-1',
  fencingToken: 'fence-1',
  mode: 'preflight' as const,
  kind: 'validator' as const,
  language: 'python3' as const,
  protocol: 'oj.validator/v1' as const,
  source: 'validator',
  knownSubtaskIds: [] as number[],
  problemConfig: { mode: 'acm' as const },
  integration: {},
  fixtures: [
    { name: 'valid', stdin: '1\n', expectedExitCode: 0 },
    { name: 'invalid', stdin: '0\n', expectedExitCode: 1 },
  ],
}

describe('judge program verification lifecycle', () => {
  beforeEach(() => {
    release.mockClear()
    vi.mocked(acquireCompiledProgram).mockReset().mockResolvedValue({ result: { success: true, fileId: 'compiled' }, release } as any)
    vi.mocked(runValidatorProgram).mockReset()
  })

  it('treats a deliberate non-zero Validator exit as a successful negative fixture', async () => {
    vi.mocked(runValidatorProgram)
      .mockResolvedValueOnce({ result: { status: 'Accepted', time: 1, memory: 10, exitCode: 0 }, valid: true } as any)
      .mockResolvedValueOnce({ result: { status: 'Runtime Error', time: 1, memory: 10, exitCode: 3 }, valid: false } as any)

    const result = await verifyJudgeProgram(baseRequest)

    expect(result).toMatchObject({ outcome: 'success', code: 'PROGRAM_VERIFIED' })
    expect(result.report?.fixtures).toEqual([
      expect.objectContaining({ name: 'valid', passed: true }),
      expect.objectContaining({ name: 'invalid', passed: true }),
    ])
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('fails a negative fixture that times out and still releases the compiled lease', async () => {
    vi.mocked(runValidatorProgram)
      .mockResolvedValueOnce({ result: { status: 'Accepted', time: 1, memory: 10, exitCode: 0 }, valid: true } as any)
      .mockResolvedValueOnce({ result: { status: 'Time Limit Exceeded', time: 2000, memory: 10, exitCode: -1 }, valid: false } as any)

    const result = await verifyJudgeProgram(baseRequest)

    expect(result).toMatchObject({ outcome: 'program_error', code: 'PROGRAM_PREFLIGHT_FAILED', retryable: false })
    expect(result.report?.fixtures[1]).toMatchObject({ name: 'invalid', passed: false })
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('marks sandbox infrastructure failures retryable and releases resources', async () => {
    vi.mocked(runValidatorProgram).mockResolvedValueOnce({ result: { status: 'System Error', time: 0, memory: 0, exitCode: 1, infrastructureError: true, stderr: 'sandbox unavailable' }, valid: false } as any)

    const result = await verifyJudgeProgram({ ...baseRequest, fixtures: [baseRequest.fixtures[0]] })

    expect(result).toMatchObject({ outcome: 'infrastructure_error', code: 'VALIDATOR_INFRA_ERROR', retryable: true })
    expect(release).toHaveBeenCalledTimes(1)
  })
})
