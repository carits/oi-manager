#!/usr/bin/env node

const baseUrl = String(process.env.BASE_URL || 'http://127.0.0.1:3002').replace(/\/$/, '')
const authToken = String(process.env.AUTH_TOKEN || '')
const timeoutMs = Number(process.env.PROBE_TIMEOUT_MS || 180_000)

if (!authToken) {
  console.error('AUTH_TOKEN is required')
  process.exit(2)
}

const headers = {
  Authorization: `Bearer ${authToken}`,
  'Content-Type': 'application/json',
}

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.success === false) {
    throw new Error(`${method} ${path} failed (${response.status}): ${payload.code || ''} ${payload.message || JSON.stringify(payload)}`.trim())
  }
  return payload.data
}

async function waitFor(label, loader, complete, delayMs = 500) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await loader()
    if (complete(last)) return last
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`)
}

async function waitForVerification(problemId, programId, versionId, jobId) {
  return waitFor(
    `verification ${jobId}`,
    async () => {
      const jobs = await request('GET', `/api/problems/${problemId}/judge-programs/${programId}/versions/${versionId}/verification`)
      return jobs.find(item => item.id === jobId)
    },
    job => job && ['completed', 'failed', 'cancelled'].includes(job.status),
  ).then(job => {
    if (job.status !== 'completed') throw new Error(`verification ${jobId} ${job.status}: ${job.errorCode || ''} ${job.errorMessage || ''}`)
    return job
  })
}

async function createAndActivate(problemId, definition) {
  const created = await request('POST', `/api/problems/${problemId}/judge-programs`, definition)
  const programId = created.program.id
  const versionId = created.version.id

  const compileJob = await request('POST', `/api/problems/${problemId}/judge-programs/${programId}/versions/${versionId}/compile`, {})
  await waitForVerification(problemId, programId, versionId, compileJob.id)

  const preflightJob = await request('POST', `/api/problems/${problemId}/judge-programs/${programId}/versions/${versionId}/preflight`, {})
  await waitForVerification(problemId, programId, versionId, preflightJob.id)

  await request('PATCH', `/api/problems/${problemId}/judge-programs/${programId}`, { currentVersionId: versionId })
  return { programId, versionId }
}

async function waitForGeneration(problemId, jobId, contribution = false) {
  const path = contribution
    ? `/api/problems/${problemId}/contributions/${jobId}`
    : `/api/problems/${problemId}/data-generation-jobs/${jobId}`
  const job = await waitFor(
    `data generation ${jobId}`,
    () => request('GET', path),
    value => ['completed', 'failed', 'cancelled', 'promoted'].includes(value.status),
    750,
  )
  if (!['completed', 'promoted'].includes(job.status)) {
    throw new Error(`data generation ${jobId} ${job.status}: ${job.errorCode || ''} ${job.message || job.errorMessage || ''}`)
  }
  return job
}

const validatorSource = String.raw`#include <iostream>
#include <string>
int main() {
  long long a = 0, b = 0;
  if (!(std::cin >> a >> b)) return 1;
  if (a < -1000000000LL || a > 1000000000LL || b < -1000000000LL || b > 1000000000LL) return 1;
  std::string extra;
  if (std::cin >> extra) return 1;
  return 0;
}`

const standardSource = String.raw`#include <iostream>
int main() {
  long long a = 0, b = 0;
  if (!(std::cin >> a >> b)) return 1;
  std::cout << a + b << '\n';
  return 0;
}`

const classifierSource = String.raw`#include <iostream>
int main() {
  long long a = 0, b = 0;
  if (!(std::cin >> a >> b)) return 1;
  std::cout << "{\"subtasks\":[1]}\n";
  return 0;
}`

const generatorSource = String.raw`import json
import sys

context = json.load(sys.stdin)
params = context["params"]
print(params["a"], params["b"])
`

const generatorProtocolConfig = {
  parameterSchema: {
    a: { type: 'integer', minimum: -1_000_000_000, maximum: 1_000_000_000 },
    b: { type: 'integer', minimum: -1_000_000_000, maximum: 1_000_000_000 },
  },
  profiles: [
    { id: 'official-smoke', label: '正式生成探针', params: { a: 1, b: 2 } },
    { id: 'candidate-smoke', label: '候选分类探针', params: { a: -7, b: 3 } },
  ],
}

async function main() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const problem = await request('POST', '/api/problems', {
    title: `系统验证：Validator / Classifier 协议闭环 ${stamp}`,
    description: '生产发布探针草稿题，仅用于验证评测程序资产、数据生成、Classifier 与不可变测试版本闭环。',
    status: 'draft',
    problemType: 'local',
    timeLimit: 1000,
    memoryLimit: 256,
    statements: [{ format: 'markdown', language: 'zh', content: '输入两个整数，输出它们的和。' }],
    solutions: [],
  })
  const problemId = problem.id

  const configured = await request('PUT', `/api/problems/${problemId}/judge-config`, {
    problemType: 'local',
    timeLimit: 1000,
    memoryLimit: 256,
    config: {
      mode: 'oi',
      type: 'standard',
      checker_type: 'default',
      subtasks: [{
        id: 1,
        score: 100,
        groups: [
          { id: 'official-1', name: '官方测试组', kind: 'official', score: 100, type: 'min', cases: [] },
          { id: 'hack-gate', name: 'Hack 得分门槛', kind: 'hack_gate', score: 0, type: 'min', cases: [] },
        ],
      }],
    },
  })
  const initialRevisionId = configured.latestTestSetRevisionId
  if (!initialRevisionId) throw new Error('initial TestSet Revision was not created')

  const validator = await createAndActivate(problemId, {
    kind: 'validator', name: '协议探针 Validator', language: 'cpp17', protocol: 'oj.validator/v1', source: validatorSource,
    fixtures: [
      { name: '合法输入', stdin: '1 2\n', expectedExitCode: 0 },
      { name: '非法输入', stdin: '1\n', expectedExitCode: 1 },
    ],
  })
  const standard = await createAndActivate(problemId, {
    kind: 'standard', name: '协议探针 STD', language: 'cpp17', protocol: 'oj.standard/v1', source: standardSource,
    fixtures: [{ name: '求和', stdin: '1 2\n', expectedStdout: '3\n' }],
  })
  const classifier = await createAndActivate(problemId, {
    kind: 'classifier', name: '协议探针 Classifier', language: 'cpp17', protocol: 'oj.classifier/v1', source: classifierSource,
    fixtures: [{ name: '命中 Subtask 1', stdin: '-7 3\n', expectedSubtasks: [1] }],
  })
  const generator = await createAndActivate(problemId, {
    kind: 'generator', name: '协议探针 Generator', language: 'python3', protocol: 'oj.generator/v1', source: generatorSource,
    protocolConfig: generatorProtocolConfig,
    fixtures: [{
      name: '确定性生成',
      stdin: JSON.stringify({ protocol: 'oj.generator/v1', seed: '1', caseId: 1, profile: 'official-smoke', params: { a: 1, b: 2 } }),
    }],
  })

  const readiness = await request('GET', `/api/problems/${problemId}/contribution-readiness`)
  if (!readiness.canContribute || readiness.standard.status !== 'active' || readiness.validator.status !== 'active' || readiness.classifier.status !== 'active') {
    throw new Error(`unexpected readiness: ${JSON.stringify(readiness)}`)
  }

  const managerJob = await request('POST', `/api/problems/${problemId}/data-generation-jobs`, {
    sourceMode: 'generator',
    generatorVersionId: generator.versionId,
    standardVersionId: standard.versionId,
    validatorVersionId: validator.versionId,
    cases: [{ name: 'official-smoke', profile: 'official-smoke', params: {} }],
  })
  const managerResult = await waitForGeneration(problemId, managerJob.id)
  const generatedCase = managerResult.cases.find(item => item.status === 'validated')
  if (!generatedCase) throw new Error(`manager generation produced no validated case: ${JSON.stringify(managerResult.cases)}`)

  const promoted = await request('POST', `/api/problems/${problemId}/data-generation-jobs/${managerJob.id}/promote`, {
    expectedLatestRevisionId: initialRevisionId,
    caseIds: [generatedCase.id],
    assignments: [{ caseId: generatedCase.id, subtaskId: 1, groupKey: 'official-1' }],
  })
  if (promoted.revisionNumber !== 2) throw new Error(`expected Revision 2, got ${promoted.revisionNumber}`)

  const contribution = await request('POST', `/api/problems/${problemId}/candidates/generator`, {
    language: 'python3',
    source: generatorSource,
    manifest: {
      apiVersion: 'oj.generator/v1',
      protocol: 'oj.generator/v1',
      language: 'python3',
      entry: 'main.py',
      parameterSchema: generatorProtocolConfig.parameterSchema,
      profiles: [{ id: 'candidate-smoke', label: '候选分类探针', params: { a: -7, b: 3 } }],
    },
  })
  const contributionResult = await waitForGeneration(problemId, contribution.jobId, true)
  const candidateCase = contributionResult.cases.find(item => item.candidateId)
  if (!candidateCase) throw new Error(`contribution produced no candidate: ${JSON.stringify(contributionResult.cases)}`)
  if (candidateCase.stage !== 'awaiting_corpus') throw new Error(`expected awaiting_corpus, got ${candidateCase.stage}`)
  const candidate = await request('GET', `/api/problems/${problemId}/candidates/${candidateCase.candidateId}`)
  if (JSON.stringify(candidate.affectedSubtaskIds) !== JSON.stringify([1])) {
    throw new Error(`Classifier did not produce Subtask 1: ${JSON.stringify(candidate.affectedSubtaskIds)}`)
  }

  console.log(JSON.stringify({
    type: 'judge_program_workflow_probe',
    problemId,
    problemNumber: problem.problemId,
    initialRevision: 1,
    promotedRevision: promoted.revisionNumber,
    activePrograms: {
      validator: validator.versionId,
      standard: standard.versionId,
      classifier: classifier.versionId,
      generator: generator.versionId,
    },
    contributionStage: candidateCase.stage,
    affectedSubtaskIds: candidate.affectedSubtaskIds,
  }))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
