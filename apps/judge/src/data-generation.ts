import fs from 'fs'
import os from 'os'
import path from 'path'
import { acquireCompiledProgram } from './compiled-program-cache'
import { execute } from './sandbox/client'
import { config } from './config'
import { judge } from './judge'
import type { DataGenerationRequest, DataGenerationResult, ProblemConfig } from './types'

const MAX_DATA = 1024 * 1024
function testlib() { return { 'testlib.h': fs.readFileSync(path.join(config.checkerIncludeDir, 'testlib.h'), 'utf8') } }

export async function generateTestdata(request: DataGenerationRequest): Promise<DataGenerationResult> {
  let generator: Awaited<ReturnType<typeof acquireCompiledProgram>> | null = null
  let standard: Awaited<ReturnType<typeof acquireCompiledProgram>> | null = null
  let validator: Awaited<ReturnType<typeof acquireCompiledProgram>> | null = null
  try {
    if (request.sourceMode === 'generator') {
      if (!request.generator) throw new Error('生成器程序缺失')
      generator = await acquireCompiledProgram({ language: request.generator.language, code: request.generator.source }, false)
    }
    standard = await acquireCompiledProgram({ language: request.standard.language, code: request.standard.source }, true)
    validator = await acquireCompiledProgram({ language: request.validator.language, code: request.validator.source, extraCopyIn: testlib() }, true)
  } catch (error: any) {
    await Promise.allSettled([generator?.release(), standard?.release(), validator?.release()].filter(Boolean) as Promise<void>[])
    return { jobId: request.jobId, fencingToken: request.fencingToken, cases: request.cases.map(item => ({ id: item.id, status: 'failed', failureStage: 'compile', message: error.message })) }
  }
  const results: DataGenerationResult['cases'] = []
  try {
    for (const [index, item] of request.cases.entries()) {
      let input = item.inputData || '', generatorTimeMs = 0
      if (request.sourceMode === 'generator') {
        const run = await execute({ language: request.generator!.language, timeLimit: 5000, memoryLimit: 262_144, outputLimit: MAX_DATA, compileFileId: generator!.result.fileId, workDir: generator!.result.workDir, args: item.args || [], env: { CASE_INDEX: String(index + 1), CASE_SEED: item.seed || '' } })
        generatorTimeMs = run.time
        if (run.infrastructureError) return { jobId: request.jobId, fencingToken: request.fencingToken, retryable: true, cases: results }
        if (run.status !== 'Accepted') { results.push({ id: item.id, status: 'failed', failureStage: 'generator', message: `${run.status}${run.stderr ? `：${run.stderr.slice(0, 1000)}` : ''}`, generatorTimeMs }); continue }
        input = run.stdout || ''
      }
      if (!input.trim() || Buffer.byteLength(input) > MAX_DATA) { results.push({ id: item.id, status: 'failed', failureStage: 'input', message: '输入为空或超过 1 MiB', generatorTimeMs }); continue }
      const validated = await execute({ language: 'cpp17', stdin: input, timeLimit: 2000, memoryLimit: 262_144, outputLimit: 64 * 1024, compileFileId: validator!.result.fileId, workDir: validator!.result.workDir })
      if (validated.infrastructureError) return { jobId: request.jobId, fencingToken: request.fencingToken, retryable: true, cases: results }
      if (validated.status !== 'Accepted' || validated.exitCode !== 0) { results.push({ id: item.id, status: 'failed', failureStage: 'validator', message: `Validator 拒绝输入${validated.stderr ? `：${validated.stderr.slice(0, 1000)}` : ''}`, generatorTimeMs, validatorTimeMs: validated.time }); continue }
      const answered = await execute({ language: 'cpp17', stdin: input, filename: request.filename || undefined, timeLimit: 30_000, memoryLimit: 524_288, outputLimit: MAX_DATA, compileFileId: standard!.result.fileId, workDir: standard!.result.workDir })
      if (answered.infrastructureError) return { jobId: request.jobId, fencingToken: request.fencingToken, retryable: true, cases: results }
      const output = answered.stdout || ''
      if (answered.status !== 'Accepted' || !output.length || Buffer.byteLength(output) > MAX_DATA) { results.push({ id: item.id, status: 'failed', failureStage: 'standard', message: `STD 运行失败：${answered.status}${answered.stderr ? `；${answered.stderr.slice(0, 1000)}` : ''}`, generatorTimeMs, validatorTimeMs: validated.time, standardTimeMs: answered.time }); continue }
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
      results.push({ id: item.id, status: 'validated', inputData: input, outputData: output, generatorTimeMs, validatorTimeMs: validated.time, standardTimeMs: answered.time })
    }
    return { jobId: request.jobId, fencingToken: request.fencingToken, cases: results }
  } finally { await Promise.allSettled([generator?.release(), standard?.release(), validator?.release()].filter(Boolean) as Promise<void>[]) }
}
