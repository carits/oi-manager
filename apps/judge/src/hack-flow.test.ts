import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { judgeHack } from './hack'
import { acquireCompiledProgram } from './compiled-program-cache'
import { judge } from './judge'
import { runClassifierProgram, runStandardProgram, runValidatorProgram } from './judge-program-runner'

vi.mock('./compiled-program-cache', () => ({ acquireCompiledProgram: vi.fn() }))
vi.mock('./judge', () => ({ judge: vi.fn() }))
vi.mock('./judge-program-runner', () => ({
  runClassifierProgram: vi.fn(),
  runGeneratorProgram: vi.fn(),
  runStandardProgram: vi.fn(),
  runValidatorProgram: vi.fn(),
}))

let testdataPath = ''
const release = vi.fn(async () => undefined)
const request = () => ({
  taskType: 'hack' as const,
  hackAttemptId: 'oi-hack-1',
  problemId: 'problem-1',
  judgeConfigHash: 'config-hash',
  hackConfigRevision: 1,
  testdataPath,
  hackMode: 'oi' as const,
  inputMode: 'data' as const,
  inputData: '5 -9\n',
  hackSource: 'wrong solution',
  hackLanguage: 'cpp17',
  standardSource: 'standard',
  validatorSource: 'validator',
  validatorLanguage: 'python3' as const,
  classifierSource: 'classifier',
  classifierLanguage: 'python3' as const,
  config: {
    mode: 'oi' as const,
    checker_type: 'default',
    subtasks: [{ id: 1, score: 100, groups: [
      { id: 'official-1', kind: 'official' as const, score: 100, type: 'min' as const, cases: [] },
      { id: 'hack-gate-1', kind: 'hack_gate' as const, score: 0, type: 'min' as const, cases: [] },
    ] }],
  },
})

describe('OI Hack program protocol flow', () => {
  beforeEach(async () => {
    testdataPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oi-hack-flow-'))
    release.mockClear()
    vi.mocked(acquireCompiledProgram).mockReset().mockResolvedValue({ result: { success: true, fileId: 'compiled' }, release } as any)
    vi.mocked(judge).mockReset()
    vi.mocked(runValidatorProgram).mockReset().mockResolvedValue({ result: { status: 'Accepted', exitCode: 0, time: 1, memory: 1 }, valid: true } as any)
    vi.mocked(runClassifierProgram).mockReset().mockResolvedValue({ result: { status: 'Accepted', exitCode: 0, time: 1, memory: 1, stdout: '{"subtasks":[1]}' }, subtasks: [1], error: null } as any)
    vi.mocked(runStandardProgram).mockReset().mockResolvedValue({ result: { status: 'Accepted', exitCode: 0, time: 1, memory: 1, stdout: '-4\n' }, output: '-4\n' } as any)
  })

  afterEach(async () => { await fs.promises.rm(testdataPath, { recursive: true, force: true }) })

  it('accepts Validator → Classifier → STD → Hack Gate when score drops', async () => {
    vi.mocked(judge)
      .mockResolvedValueOnce({ submissionId: 'self', result: 'Accepted', score: 100, time: 1, memory: 1, cases: [] })
      .mockResolvedValueOnce({ submissionId: 'baseline', result: 'Accepted', score: 100, time: 1, memory: 1, cases: [] })
      .mockResolvedValueOnce({ submissionId: 'candidate', result: 'Wrong Answer', score: 0, time: 1, memory: 1, cases: [] })

    const result = await judgeHack(request())

    expect(result).toMatchObject({ outcome: 'accepted', baselineScore: 100, candidateScore: 0, affectedSubtaskIds: [1], inputData: '5 -9\n', outputData: '-4\n' })
    expect(vi.mocked(judge).mock.calls[2]?.[0].config.subtasks?.[0].groups?.[1].cases).toHaveLength(1)
    expect(release).toHaveBeenCalledTimes(3)
  })

  it('fails closed when Classifier output cannot be mapped to a known Subtask', async () => {
    vi.mocked(runClassifierProgram).mockResolvedValueOnce({ result: { status: 'Accepted', exitCode: 0, time: 1, memory: 1, stdout: '{"subtasks":[9]}' }, subtasks: null, error: '未知 Subtask 9' } as any)

    const result = await judgeHack(request())

    expect(result).toMatchObject({ outcome: 'system_error', failureStage: 'classifier' })
    expect(result.message).toContain('未知 Subtask')
    expect(judge).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledTimes(2)
  })
})
