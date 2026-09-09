import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireCompiledProgram } from './compiled-program-cache'
import { judge } from './judge'
import { runClassifierProgram, runValidatorProgram } from './judge-program-runner'
import { verifyQualityEvaluation } from './quality-evaluation-verification'

vi.mock('./compiled-program-cache', () => ({ acquireCompiledProgram: vi.fn() }))
vi.mock('./judge', () => ({ judge: vi.fn() }))
vi.mock('./judge-program-runner', () => ({ runClassifierProgram: vi.fn(), runValidatorProgram: vi.fn() }))

const directories: string[] = []

async function makeRequest() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'quality-verification-'))
  directories.push(root)
  await fs.promises.writeFile(path.join(root, '1.in'), '2\n1 2\n')
  await fs.promises.writeFile(path.join(root, '1.out'), '3\n')
  return {
    taskType: 'quality_evaluation_verification' as const,
    jobId: 'job-1', problemId: 'problem-1', fencingToken: 'fence-1', testdataPath: root,
    problemConfig: { mode: 'oi' as const, time: '1s', memory: '256MB', subtasks: [] },
    standard: { language: 'cpp17', source: 'std' },
    validator: { language: 'cpp17', source: 'validator' },
    classifier: { language: 'cpp17', source: 'classifier' },
    knownSubtaskIds: [1],
    cases: [{ key: 'input:output', input: '1.in', output: '1.out', expectedSubtaskIds: [1] }],
  }
}

beforeEach(() => {
  vi.mocked(acquireCompiledProgram).mockReset().mockResolvedValue({ result: { fileId: 'compiled' }, release: vi.fn() } as any)
  vi.mocked(runValidatorProgram).mockReset().mockResolvedValue({ result: { status: 'Accepted', exitCode: 0 }, valid: true } as any)
  vi.mocked(runClassifierProgram).mockReset().mockResolvedValue({ result: { status: 'Accepted', exitCode: 0 }, subtasks: [1], error: null } as any)
  vi.mocked(judge).mockReset()
    .mockResolvedValueOnce({ result: 'Accepted', score: 100, cases: [], time: 1, memory: 1 } as any)
    .mockResolvedValueOnce({ result: 'Wrong Answer', score: 0, cases: [], time: 1, memory: 1 } as any)
})

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.promises.rm(directory, { recursive: true, force: true })))
})

describe('quality evaluation semantic verification', () => {
  it('passes only after Validator, Classifier, STD and Checker all pass', async () => {
    const result = await verifyQualityEvaluation(await makeRequest())
    expect(result.report).toMatchObject({
      outcome: 'passed',
      standard: { passed: true },
      validator: { passed: 1, failed: 0 },
      classifier: { passed: 1, failed: 0 },
      checker: { passed: true },
    })
  })

  it('marks canonical input rejection and Subtask mismatch as critical', async () => {
    vi.mocked(runValidatorProgram).mockResolvedValueOnce({ result: { status: 'Runtime Error', exitCode: 1 }, valid: false } as any)
    vi.mocked(runClassifierProgram).mockResolvedValueOnce({ result: { status: 'Accepted', exitCode: 0 }, subtasks: [], error: null } as any)
    const result = await verifyQualityEvaluation(await makeRequest())
    expect(result.report?.outcome).toBe('critical')
    expect(result.report?.cases[0]).toMatchObject({ validatorPassed: false, classifierPassed: false, code: 'VALIDATOR_REJECTED_CANONICAL_INPUT' })
  })

  it('retries infrastructure failures instead of issuing a certificate', async () => {
    vi.mocked(runValidatorProgram).mockResolvedValueOnce({ result: { status: 'System Error', exitCode: 1, infrastructureError: true }, valid: false } as any)
    const result = await verifyQualityEvaluation(await makeRequest())
    expect(result).toMatchObject({ jobId: 'job-1', fencingToken: 'fence-1', retryable: true })
    expect(result.report).toBeUndefined()
  })
})
