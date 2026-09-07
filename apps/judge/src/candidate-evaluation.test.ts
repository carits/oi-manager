import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CandidateEvaluationRequest } from './types'

const { judgeMock } = vi.hoisted(() => ({ judgeMock: vi.fn() }))
vi.mock('./judge', () => ({ judge: judgeMock }))
import { evaluateCandidate } from './candidate-evaluation'

const roots: string[] = []
afterEach(async () => { judgeMock.mockReset(); await Promise.all(roots.splice(0).map(root => fs.promises.rm(root, { recursive: true, force: true }))) })

async function request(): Promise<CandidateEvaluationRequest> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'candidate-eval-test-'))
  roots.push(root)
  await fs.promises.writeFile(path.join(root, '1.in'), '1\n')
  await fs.promises.writeFile(path.join(root, '1.out'), '1\n')
  return { taskType: 'candidate_evaluation', runId: 'run', candidateId: 'candidate', problemId: 'problem', fencingToken: 'fence', stage: 'l1', testdataPath: root, problemConfig: { mode: 'oi', time: '1s', memory: '256MB' }, candidateInputBase64: Buffer.from('2\n').toString('base64'), candidateOutputBase64: Buffer.from('2\n').toString('base64'), maxExecutionCount: 400, maxCpuMilliseconds: 60_000, cases: [{ key: 'official-1', input: '1.in', output: '1.out' }], samples: [{ sampleId: 'sample', clusterId: 'cluster', weight: 5, language: 'cpp17', source: 'int main(){}' }] }
}

describe('candidate evaluation runner', () => {
  it('returns the per-case kill vector including the candidate', async () => {
    judgeMock.mockResolvedValue({ result: 'Wrong Answer', retryable: false, cases: [{ result: 'Accepted', time: 1 }, { result: 'Wrong Answer', time: 2 }] })
    const result = await evaluateCandidate(await request())
    expect(result.clusters).toEqual([{ clusterId: 'cluster', weight: 5, killedCaseKeys: ['candidate'] }])
    expect(result.executionCount).toBe(2)
  })

  it('marks compile failures as unstable corpus samples', async () => {
    judgeMock.mockResolvedValue({ result: 'Compilation Error', retryable: false, cases: [] })
    const result = await evaluateCandidate(await request())
    expect(result.unstableSampleIds).toEqual(['sample'])
    expect(result.clusters).toEqual([])
  })

  it('asks the server to retry infrastructure failures', async () => {
    judgeMock.mockResolvedValue({ result: 'System Error', retryable: true, cases: [], message: 'sandbox down' })
    const result = await evaluateCandidate(await request())
    expect(result.retryable).toBe(true)
  })

  it('stops before another sample once the task CPU budget is exhausted', async () => {
    const input = await request()
    input.maxCpuMilliseconds = 1
    input.samples.push({ ...input.samples[0], sampleId: 'sample-2', clusterId: 'cluster-2' })
    judgeMock.mockResolvedValue({ result: 'Accepted', retryable: false, cases: [{ result: 'Accepted', time: 1 }, { result: 'Accepted', time: 2 }] })
    const result = await evaluateCandidate(input)
    expect(judgeMock).toHaveBeenCalledTimes(1)
    expect(result.cpuMilliseconds).toBe(3)
  })
})
