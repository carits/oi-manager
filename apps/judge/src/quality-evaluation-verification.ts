import fs from 'node:fs'
import path from 'node:path'
import { acquireCompiledProgram } from './compiled-program-cache'
import { config } from './config'
import { judge } from './judge'
import { runClassifierProgram, runValidatorProgram } from './judge-program-runner'
import type { QualityEvaluationVerificationRequest, QualityEvaluationVerificationResult } from './types'

function dependencies() {
  const header = path.join(config.checkerIncludeDir, 'testlib.h')
  if (!fs.existsSync(header)) throw new Error('系统 testlib.h 不可用')
  return { 'testlib.h': fs.readFileSync(header, 'utf8') }
}

function safeCasePath(root: string, name: string) {
  const normalizedRoot = path.resolve(root)
  const target = path.resolve(normalizedRoot, name)
  if (target === normalizedRoot || !target.startsWith(`${normalizedRoot}${path.sep}`)) throw new Error('测试点路径越界')
  return target
}

function sameIds(left: number[] | null, right: number[]) {
  return Boolean(left) && left!.length === right.length && left!.every((id, index) => id === right[index])
}

function infrastructure(error: unknown) {
  return Boolean((error as Error & { infrastructureError?: boolean })?.infrastructureError)
}

export async function verifyQualityEvaluation(request: QualityEvaluationVerificationRequest): Promise<QualityEvaluationVerificationResult> {
  const base = { jobId: request.jobId, fencingToken: request.fencingToken }
  let validator: Awaited<ReturnType<typeof acquireCompiledProgram>> | null = null
  let classifier: Awaited<ReturnType<typeof acquireCompiledProgram>> | null = null
  try {
    validator = await acquireCompiledProgram({
      language: request.validator.language,
      code: request.validator.source,
      extraCopyIn: request.validator.language === 'cpp17' ? dependencies() : undefined,
    }, true)
    if (request.classifier) {
      classifier = await acquireCompiledProgram({
        language: request.classifier.language,
        code: request.classifier.source,
        extraCopyIn: request.classifier.language === 'cpp17' ? dependencies() : undefined,
      }, true)
    }
  } catch (error) {
    await validator?.release().catch(() => undefined)
    await classifier?.release().catch(() => undefined)
    if (infrastructure(error)) return { ...base, retryable: true }
    return { ...base, report: {
      outcome: 'not_ready',
      standard: { passed: false, verdict: 'Not Ready', score: 0 },
      validator: { passed: 0, failed: request.cases.length },
      classifier: { passed: 0, failed: request.classifier ? request.cases.length : 0, required: Boolean(request.classifier) },
      checker: { passed: false }, cases: [],
    } }
  }

  const cases: NonNullable<QualityEvaluationVerificationResult['report']>['cases'] = []
  let validatorPassed = 0
  let classifierPassed = 0
  try {
    for (const item of request.cases) {
      let input: string
      try { input = await fs.promises.readFile(safeCasePath(request.testdataPath, item.input), 'utf8') }
      catch { return { ...base, retryable: true } }
      const validation = await runValidatorProgram({
        language: request.validator.language, artifact: validator.result, stdin: input,
        timeLimit: 2_000, memoryLimit: 262_144, outputLimit: 65_536,
      })
      if (validation.result.infrastructureError) return { ...base, retryable: true }
      const validatorOk = validation.valid
      if (validatorOk) validatorPassed++
      let classifierOk: boolean | null = null
      if (request.classifier && classifier) {
        const classified = await runClassifierProgram({
          language: request.classifier.language, artifact: classifier.result, stdin: input,
          timeLimit: 2_000, memoryLimit: 262_144, outputLimit: 65_536,
          knownSubtaskIds: request.knownSubtaskIds,
        })
        if (classified.result.infrastructureError) return { ...base, retryable: true }
        classifierOk = sameIds(classified.subtasks, item.expectedSubtaskIds)
        if (classifierOk) classifierPassed++
      }
      cases.push({
        key: item.key,
        validatorPassed: validatorOk,
        classifierPassed: classifierOk,
        ...(!validatorOk ? { code: 'VALIDATOR_REJECTED_CANONICAL_INPUT' } : classifierOk === false ? { code: 'CLASSIFIER_SUBTASK_MISMATCH' } : {}),
      })
    }
  } finally {
    await validator.release()
    await classifier?.release()
  }

  const standard = await judge({
    submissionId: `quality-standard-${request.jobId}`,
    problemId: request.problemId,
    code: request.standard.source,
    language: request.standard.language,
    config: request.problemConfig,
    testdataPath: request.testdataPath,
    ioAdapterVersion: 1,
    io: { inputFile: null, outputFile: null },
  })
  if (standard.retryable || standard.result === 'System Error') return { ...base, retryable: true }
  const standardPassed = standard.result === 'Accepted' && standard.score === 100
  const sentinel = `__CARITS_CHECKER_NEGATIVE_PROBE_${request.jobId.replace(/[^A-Za-z0-9_-]/g, '_')}__`
  const negative = await judge({
    submissionId: `quality-checker-negative-${request.jobId}`,
    problemId: request.problemId,
    code: `#include <iostream>\nint main(){std::cout << ${JSON.stringify(sentinel)} << "\\n";}\n`,
    language: 'cpp17',
    config: request.problemConfig,
    testdataPath: request.testdataPath,
    ioAdapterVersion: 1,
    io: { inputFile: null, outputFile: null },
  })
  if (negative.retryable || negative.result === 'System Error') return { ...base, retryable: true }
  const checkerPassed = negative.result !== 'Accepted' && negative.score < 100
  const validatorFailed = request.cases.length - validatorPassed
  const classifierFailed = request.classifier ? request.cases.length - classifierPassed : 0
  const passed = standardPassed && checkerPassed && validatorFailed === 0 && classifierFailed === 0
  return {
    ...base,
    report: {
      outcome: passed ? 'passed' : 'critical',
      standard: { passed: standardPassed, verdict: standard.result, score: standard.score, message: standard.message?.slice(0, 500) },
      validator: { passed: validatorPassed, failed: validatorFailed },
      classifier: { passed: classifierPassed, failed: classifierFailed, required: Boolean(request.classifier) },
      checker: { passed: checkerPassed },
      cases,
    },
  }
}
