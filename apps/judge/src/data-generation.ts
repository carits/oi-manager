import fs from 'fs'
import crypto from 'node:crypto'
import os from 'os'
import path from 'path'
import { acquireCompiledProgram } from './compiled-program-cache'
import { config } from './config'
import { judge } from './judge'
import type { DataGenerationRequest, DataGenerationResult, ProblemConfig } from './types'
import { OJ_GENERATOR_CPP_HEADER } from '@oi-manager/shared'
import { runClassifierProgram, runGeneratorProgram, runStandardProgram, runValidatorProgram } from './judge-program-runner'

const DEFAULT_MAX_DATA = 1024 * 1024
function testlib() { return { 'testlib.h': fs.readFileSync(path.join(config.checkerIncludeDir, 'testlib.h'), 'utf8') } }

export async function generateTestdata(request: DataGenerationRequest): Promise<DataGenerationResult> {
  const maxData = Math.min(Math.max(request.maxDataBytes || DEFAULT_MAX_DATA, 1), 16 * 1024 * 1024)
  let generator: Awaited<ReturnType<typeof acquireCompiledProgram>> | null = null
  let standard: Awaited<ReturnType<typeof acquireCompiledProgram>> | null = null
  let validator: Awaited<ReturnType<typeof acquireCompiledProgram>> | null = null
  let classifier: Awaited<ReturnType<typeof acquireCompiledProgram>> | null = null
  try {
    if (request.sourceMode === 'generator') {
      if (!request.generator) throw new Error('生成器程序缺失')
      generator = await acquireCompiledProgram({ language: request.generator.language, code: request.generator.source, extraCopyIn: request.generator.protocol === 'oj.generator/v1' && request.generator.language === 'cpp17' ? { 'oj_generator.hpp': OJ_GENERATOR_CPP_HEADER } : undefined }, false)
    }
    standard = await acquireCompiledProgram({ language: request.standard.language, code: request.standard.source }, true)
    validator = await acquireCompiledProgram({ language: request.validator.language, code: request.validator.source, extraCopyIn: testlib() }, true)
    if (request.classifier) classifier = await acquireCompiledProgram({ language: request.classifier.language, code: request.classifier.source, extraCopyIn: testlib() }, true)
  } catch (error: any) {
    await Promise.allSettled([generator?.release(), standard?.release(), validator?.release(), classifier?.release()].filter(Boolean) as Promise<void>[])
    return { jobId: request.jobId, fencingToken: request.fencingToken, cases: request.cases.map(item => ({ id: item.id, status: 'failed', failureStage: 'compile', message: error.message })) }
  }
  const results: DataGenerationResult['cases'] = []
  try {
    for (const [index, item] of request.cases.entries()) {
      let input = item.inputData || '', generatorTimeMs = 0
      if (request.sourceMode === 'generator') {
        const protocol = request.generator!.protocol || 'legacy-args-v1'
        const isV1 = protocol === 'json-stdin-v1' || protocol === 'oj.generator/v1'
        const generatorInput = isV1 ? JSON.stringify({ protocol: 'oj.generator/v1', seed: item.seed || '', caseId: index + 1, profile: item.profile || item.name, params: item.params || {} }) : undefined
        const generated = await runGeneratorProgram({ language: request.generator!.language, stdin: generatorInput || '', timeLimit: 5000, memoryLimit: 262_144, outputLimit: maxData, artifact: generator!.result, args: isV1 ? [] : (item.args || []), env: { CASE_INDEX: String(index + 1), CASE_SEED: item.seed || '' }, deterministic: isV1 })
        const run = generated.first
        generatorTimeMs = generated.totalTime
        if (run.infrastructureError) return { jobId: request.jobId, fencingToken: request.fencingToken, retryable: true, cases: results }
        if (run.status !== 'Accepted') { results.push({ id: item.id, status: 'failed', failureStage: 'generator', message: `${run.status}${run.stderr ? `：${run.stderr.slice(0, 1000)}` : ''}`, generatorTimeMs }); continue }
        input = run.stdout || ''
        if (isV1) {
          if (generated.second?.infrastructureError) return { jobId: request.jobId, fencingToken: request.fencingToken, retryable: true, cases: results }
          if (!generated.deterministic) {
            results.push({ id: item.id, status: 'failed', failureStage: 'generator', message: 'GENERATOR_NON_DETERMINISTIC：相同 seed 与参数产生了不同输出', generatorTimeMs }); continue
          }
        }
      }
      if (!input.trim() || Buffer.byteLength(input) > maxData) { results.push({ id: item.id, status: 'failed', failureStage: 'input', message: `输入为空或超过 ${Math.ceil(maxData / (1024 * 1024))} MiB`, generatorTimeMs }); continue }
      const validatorRun = await runValidatorProgram({ language: request.validator.language, stdin: input, timeLimit: 2000, memoryLimit: 262_144, outputLimit: 64 * 1024, artifact: validator!.result })
      const validated = validatorRun.result
      if (validated.infrastructureError) return { jobId: request.jobId, fencingToken: request.fencingToken, retryable: true, cases: results }
      if (!validatorRun.valid) { results.push({ id: item.id, status: 'failed', failureStage: 'validator', message: `Validator 拒绝输入${validated.stderr ? `：${validated.stderr.slice(0, 1000)}` : ''}`, generatorTimeMs, validatorTimeMs: validated.time }); continue }
      const inputSha256 = crypto.createHash('sha256').update(input).digest('hex')
      if (request.knownInputSha256?.includes(inputSha256)) { results.push({ id: item.id, status: 'failed', failureStage: 'deduplication', message: '与现有候选或正式测试数据完全重复', inputData: input, generatorTimeMs, validatorTimeMs: validated.time }); continue }
      const standardRun = await runStandardProgram({ language: 'cpp17', stdin: input, timeLimit: 30_000, memoryLimit: 524_288, outputLimit: maxData, artifact: standard!.result })
      const answered = standardRun.result
      if (answered.infrastructureError) return { jobId: request.jobId, fencingToken: request.fencingToken, retryable: true, cases: results }
      const output = standardRun.output
      if (answered.status !== 'Accepted' || !output.length || Buffer.byteLength(output) > maxData) { results.push({ id: item.id, status: 'failed', failureStage: 'standard', message: `STD 运行失败：${answered.status}${answered.stderr ? `；${answered.stderr.slice(0, 1000)}` : ''}`, generatorTimeMs, validatorTimeMs: validated.time, standardTimeMs: answered.time }); continue }
      const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), `data-gen-${request.jobId}-`))
      try {
        await fs.promises.writeFile(path.join(temp, 'candidate.in'), input)
        await fs.promises.writeFile(path.join(temp, 'candidate.out'), output)
        const checkConfig: ProblemConfig = { ...request.problemConfig, mode: 'acm', cases: [{ input: 'candidate.in', output: 'candidate.out' }] }
        delete checkConfig.subtasks
        const self = await judge({ submissionId: `data-generation-${request.jobId}-${index}`, problemId: request.problemId, code: request.standard.source, language: 'cpp17', config: checkConfig, testdataPath: temp })
        if (self.retryable) return { jobId: request.jobId, fencingToken: request.fencingToken, retryable: true, cases: results }
        if (self.result !== 'Accepted') { results.push({ id: item.id, status: 'failed', failureStage: 'checker', message: `STD 与 Checker 自检失败：${self.result}`, generatorTimeMs, validatorTimeMs: validated.time, standardTimeMs: answered.time }); continue }
      } finally { await fs.promises.rm(temp, { recursive: true, force: true }) }
      let classificationStatus: 'classified' | 'missing' | 'failed' | 'not_required' = 'not_required'
      let classificationMessage: string | undefined, affectedSubtaskIds: number[] | undefined
      if (request.problemConfig.mode === 'oi') {
        if (!classifier) classificationStatus = 'missing'
        else {
          const classifiedRun = await runClassifierProgram({ language: request.classifier!.language, stdin: input, timeLimit: 2000, memoryLimit: 262_144, outputLimit: 64 * 1024, artifact: classifier.result, knownSubtaskIds: (request.problemConfig.subtasks || []).map((subtask, subtaskIndex) => Number(subtask.id || subtaskIndex + 1)) })
          const classified = classifiedRun.result
          if (classified.infrastructureError) return { jobId: request.jobId, fencingToken: request.fencingToken, retryable: true, cases: results }
          try {
            if (!classifiedRun.subtasks) throw new Error(classifiedRun.error || classified.status)
            affectedSubtaskIds = classifiedRun.subtasks
            classificationStatus = 'classified'
          } catch (error) {
            classificationStatus = 'failed'
            classificationMessage = `Classifier 暂时无法分类：${String((error as Error).message).slice(0, 500)}`
          }
        }
      }
      results.push({ id: item.id, status: 'validated', inputData: input, outputData: output, generatorTimeMs, validatorTimeMs: validated.time, standardTimeMs: answered.time, classificationStatus, classificationMessage, affectedSubtaskIds })
    }
    return { jobId: request.jobId, fencingToken: request.fencingToken, cases: results }
  } finally { await Promise.allSettled([generator?.release(), standard?.release(), validator?.release(), classifier?.release()].filter(Boolean) as Promise<void>[]) }
}
