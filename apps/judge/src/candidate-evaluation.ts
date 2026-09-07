import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CandidateEvaluationRequest, CandidateEvaluationResult, ProblemConfig, TestCaseConfig } from './types'
import { judge } from './judge'

async function materializeCaseFiles(request: CandidateEvaluationRequest, root: string) {
  const sourceRoot = path.resolve(request.testdataPath)
  const targetRoot = path.resolve(root)
  for (const item of request.cases) for (const name of [item.input, item.output]) {
    const source = path.resolve(sourceRoot, name)
    const target = path.resolve(targetRoot, name)
    if (!source.startsWith(`${sourceRoot}${path.sep}`) || !target.startsWith(`${targetRoot}${path.sep}`)) throw new Error('Candidate evaluation case path is invalid')
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    try { await fs.promises.link(source, target) } catch { await fs.promises.copyFile(source, target) }
  }
  await fs.promises.writeFile(path.join(root, '__candidate.in'), Buffer.from(request.candidateInputBase64, 'base64'))
  await fs.promises.writeFile(path.join(root, '__candidate.out'), Buffer.from(request.candidateOutputBase64, 'base64'))
}

function evaluationConfig(request: CandidateEvaluationRequest): ProblemConfig {
  const cases: TestCaseConfig[] = [...request.cases.map(item => ({ input: item.input, output: item.output, score: 1 })), { input: '__candidate.in', output: '__candidate.out', score: 1 }]
  return { ...request.problemConfig, mode: 'oi', filename: undefined, cases: undefined, subtasks: [{ id: 1, score: cases.length, type: 'sum', cases }] }
}

export async function evaluateCandidate(request: CandidateEvaluationRequest): Promise<CandidateEvaluationResult> {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'oi-candidate-eval-'))
  let executionCount = 0
  let cpuMilliseconds = 0
  const clusters: CandidateEvaluationResult['clusters'] = []
  const unstableSampleIds: string[] = []
  try {
    await materializeCaseFiles(request, temp)
    const config = evaluationConfig(request)
    const caseKeys = [...request.cases.map(item => item.key), 'candidate']
    for (const sample of request.samples) {
      if (executionCount >= request.maxExecutionCount || cpuMilliseconds >= request.maxCpuMilliseconds) break
      const result = await judge({ submissionId: `candidate-eval-${request.runId}-${sample.sampleId}`, problemId: request.problemId, code: sample.source, language: sample.language, config, testdataPath: temp, ioAdapterVersion: 1, io: { inputFile: sample.inputFilename || null, outputFile: sample.outputFilename || null } })
      if (result.retryable) return { runId: request.runId, candidateId: request.candidateId, fencingToken: request.fencingToken, stage: request.stage, retryable: true, executionCount, cpuMilliseconds, clusters: [], unstableSampleIds, message: result.message || '候选评估沙箱基础设施失败' }
      executionCount += result.cases.filter(item => item.result !== 'Skipped').length
      cpuMilliseconds += result.cases.reduce((sum, item) => sum + (item.cpuTime ?? item.time ?? 0), 0)
      if (result.result === 'Compilation Error' || result.result === 'System Error' || result.cases.length !== caseKeys.length) { unstableSampleIds.push(sample.sampleId); continue }
      clusters.push({ clusterId: sample.clusterId, weight: sample.weight, killedCaseKeys: result.cases.flatMap((item, index) => item.result !== 'Accepted' && item.result !== 'Skipped' ? [caseKeys[index]] : []) })
    }
    return { runId: request.runId, candidateId: request.candidateId, fencingToken: request.fencingToken, stage: request.stage, executionCount, cpuMilliseconds, clusters, unstableSampleIds }
  } finally {
    await fs.promises.rm(temp, { recursive: true, force: true }).catch(() => undefined)
  }
}
