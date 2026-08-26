import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { prisma } from '../../prisma'
import {
  TestSetRevisionConflict,
  ingestTestdataObject,
  loadRevisionSpec,
  publishTestSetRevision,
} from './problem.testset-revision.service'

export const HACK_SOURCE_LIMIT = 256 * 1024
export const HACK_INPUT_LIMIT = 1024 * 1024
const HACK_TARGET_LANGUAGES = new Set(['c', 'c11', 'cpp', 'cpp11', 'cpp14', 'cpp17', 'cpp20', 'python3'])

const TESTDATA_ROOT = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')

export function serializeHackAttempt(attempt: any, includePrivate: boolean) {
  const data: Record<string, any> = {
    id: attempt.id,
    problemId: attempt.problemId,
    userId: attempt.userId,
    username: attempt.User?.username,
    status: attempt.status,
    inputMode: attempt.inputMode,
    generatorLanguage: attempt.generatorLanguage,
    hackLanguage: attempt.hackLanguage,
    baselineResult: attempt.baselineResult,
    baselineScore: attempt.baselineScore,
    candidateResult: attempt.candidateResult,
    candidateScore: attempt.candidateScore,
    scoreDelta: attempt.scoreDelta,
    affectedSubtaskIds: attempt.affectedSubtaskIds ? JSON.parse(attempt.affectedSubtaskIds) : [],
    acceptedTestcaseId: attempt.acceptedTestcaseId,
    testGraphRevision: attempt.testGraphRevision,
    baseTestSetRevisionId: attempt.baseTestSetRevisionId,
    candidateTestcaseId: attempt.candidateTestcaseId,
    promotedRevisionId: attempt.promotedRevisionId,
    canonicalStatus: attempt.canonicalStatus,
    promotionRetries: attempt.promotionRetries,
    baseTestSetRevision: attempt.BaseTestSetRevision?.revisionNumber ?? null,
    promotedRevision: attempt.PromotedRevision?.revisionNumber ?? null,
    failureStage: attempt.failureStage,
    message: attempt.message,
    acceptedInputFile: attempt.acceptedInputFile,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
    finishedAt: attempt.finishedAt,
  }
  if (includePrivate) {
    data.inputData = attempt.inputData
    data.generatorSource = attempt.generatorSource
    data.hackSource = attempt.hackSource
  }
  return data
}

export function judgeConfigHash(config: string | null | undefined): string {
  return crypto.createHash('sha256').update(config || '').digest('hex')
}

export function parseJudgeConfig(config: string | null | undefined): Record<string, any> {
  if (!config?.trim()) return {}
  const parsed = yaml.load(config)
  return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : {}
}

export function resolveJudgeMode(config: Record<string, any>): 'acm' | 'oi' {
  if (config.mode === 'oi') return 'oi'
  if (config.mode === 'acm') return 'acm'
  return Array.isArray(config.subtasks) && config.subtasks.length > 0 ? 'oi' : 'acm'
}

export function isHackableJudgeConfig(config: Record<string, any>): boolean {
  const type = String(config.type || 'default')
  // `standard` is the legacy name for a traditional source-code batch task.
  // Objective tasks do not execute user source against ordinary test cases and
  // therefore cannot participate in the two-pass Hack lifecycle.
  return ['acm', 'oi'].includes(resolveJudgeMode(config)) && ['default', 'standard'].includes(type)
}

export function allowedProblemLanguages(problem: { allowedLanguages: string | null; judgeConfig: string | null }): string[] {
  const config = parseJudgeConfig(problem.judgeConfig)
  if (Array.isArray(config.langs) && config.langs.length > 0) {
    return config.langs.map(String).filter(language => HACK_TARGET_LANGUAGES.has(language))
  }
  if (problem.allowedLanguages) {
    try {
      const parsed = JSON.parse(problem.allowedLanguages)
      if (Array.isArray(parsed)) {
        const languages = parsed.map(item => typeof item === 'string' ? item : item?.id).filter(Boolean).map(String)
        if (languages.length > 0) return languages.filter(language => HACK_TARGET_LANGUAGES.has(language))
      }
    } catch {}
  }
  return [...HACK_TARGET_LANGUAGES]
}

function checkerHeader(): string {
  const candidates = [
    process.env.CHECKER_INCLUDE_DIR && path.join(process.env.CHECKER_INCLUDE_DIR, 'testlib.h'),
    path.join(process.cwd(), '..', 'judge', 'checker-includes', 'testlib.h'),
    path.join(process.cwd(), 'apps', 'judge', 'checker-includes', 'testlib.h'),
  ].filter(Boolean) as string[]
  const target = candidates.find(candidate => fs.existsSync(candidate))
  if (!target) throw new Error('系统 testlib.h 不可用')
  return fs.readFileSync(target, 'utf8')
}

export async function validateHackCppSource(source: string, label: string): Promise<void> {
  if (!source.trim()) throw new Error(`${label}源码不能为空`)
  if (Buffer.byteLength(source, 'utf8') > HACK_SOURCE_LIMIT) throw new Error(`${label}源码不能超过 256 KiB`)

  const sandboxHost = process.env.SANDBOX_HOST || 'http://127.0.0.1:5050'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 70_000)
  try {
    const response = await fetch(`${sandboxHost}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        cmd: [{
          args: ['sh', '-c', 'g++ main.cpp -o main -O2 -std=c++17 -Wall 2>stderr'],
          env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
          copyIn: {
            'main.cpp': { content: source },
            'testlib.h': { content: checkerHeader() },
          },
          copyOut: ['stderr?'],
          cpuLimit: 60_000_000_000,
          clockLimit: 70_000_000_000,
          memoryLimit: 536_870_912,
          strictMemoryLimit: true,
          procLimit: 50,
        }],
      }),
    })
    if (!response.ok) throw new Error(`沙箱返回 HTTP ${response.status}`)
    const results = await response.json() as any[]
    const result = results?.[0]
    if (!result || result.exitStatus !== 0 || !['Accepted', 'File Error'].includes(result.status)) {
      const error = result?.files?.stderr || result?.error || result?.status || '编译失败'
      throw new Error(`${label}编译失败：${String(error).slice(0, 4000)}`)
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error(`${label}编译检查超时`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function problemDirectory(problemId: string): string {
  const root = path.resolve(TESTDATA_ROOT)
  const directory = path.resolve(root, problemId)
  if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) throw new Error('Invalid problem directory')
  return directory
}

function discoverCases(problemId: string): Array<{ input: string; output: string }> {
  const directory = problemDirectory(problemId)
  if (!fs.existsSync(directory)) return []
  const names = fs.readdirSync(directory)
  return names
    .filter(name => name.endsWith('.in') && !name.startsWith('.hack_pending_'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map(input => {
      const stem = input.slice(0, -3)
      const output = names.includes(`${stem}.out`) ? `${stem}.out` : `${stem}.ans`
      return { input, output }
    })
    .filter(item => names.includes(item.output))
}

function configuredCases(config: Record<string, any>, problemId: string): Array<Record<string, any>> {
  if (Array.isArray(config.cases) && config.cases.length > 0) return config.cases.map((item: any) => ({ ...item }))
  if (Array.isArray(config.subtasks)) {
    const seen = new Set<string>()
    const flattened = config.subtasks.flatMap((subtask: any) => subtask.cases || []).filter((item: any) => {
      const key = `${item.input}\0${item.output}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (flattened.length > 0) return flattened.map((item: any) => ({ input: item.input, output: item.output }))
  }
  return discoverCases(problemId)
}

export function appendOiHackCase(
  configText: string | null,
  affectedSubtaskIds: number[],
  testCase: { input: string; output: string },
): string {
  const config = parseJudgeConfig(configText)
  const affected = new Set(affectedSubtaskIds)
  const subtasks = (config.subtasks || []).map((subtask: any, index: number) => {
    const id = Number(subtask.id || index + 1)
    if (!affected.has(id)) return subtask
    const groups = Array.isArray(subtask.groups) ? subtask.groups.map((group: any) => ({ ...group, cases: [...(group.cases || [])] })) : []
    const gate = groups.find((group: any) => group.kind === 'hack_gate')
    if (!gate) throw new Error(`Subtask ${id} 缺少 Hack Gate`)
    gate.cases = [testCase, ...gate.cases.filter((item: any) => item.input !== testCase.input)]
    return { ...subtask, groups }
  })
  return yaml.dump({ ...config, mode: 'oi', subtasks }, { lineWidth: -1 })
}

export function hasOiHackGroups(configText: string | null): boolean {
  const config = parseJudgeConfig(configText)
  return resolveJudgeMode(config) === 'oi'
    && Array.isArray(config.subtasks)
    && config.subtasks.length > 0
    && config.subtasks.every((subtask: any) => Array.isArray(subtask.groups)
      && subtask.groups.some((group: any) => group.kind === 'hack_gate'))
}

export function appendHackCase(
  configText: string | null,
  problemId: string,
  testCase: { input: string; output: string },
): string {
  const config = parseJudgeConfig(configText)
  const cases = configuredCases(config, problemId).filter(item => item.input !== testCase.input)
  const hackCases = cases.filter(item => /^hack_[0-9a-f-]+\.in$/i.test(String(item.input)))
  const ordinaryCases = cases.filter(item => !/^hack_[0-9a-f-]+\.in$/i.test(String(item.input)))
  const next: Record<string, any> = { ...config, mode: 'acm', cases: [...hackCases, testCase, ...ordinaryCases] }
  delete next.subtasks
  return yaml.dump(next, { lineWidth: -1 })
}

export interface HackJudgeResultPayload {
  hackAttemptId: string
  outcome: 'accepted' | 'rejected' | 'system_error'
  failureStage?: 'input' | 'generator' | 'validator' | 'classifier' | 'standard' | 'checker' | 'baseline' | 'candidate'
  baselineResult?: string
  baselineScore?: number
  candidateResult?: string
  candidateScore?: number
  affectedSubtaskIds?: number[]
  message?: string
  inputData?: string
  outputData?: string
  inputSha256?: string
  outputSha256?: string
}

export async function finalizeHackResult(payload: HackJudgeResultPayload): Promise<void> {
  const attempt = await prisma.problemHackAttempt.findUnique({ where: { id: payload.hackAttemptId } })
  if (!attempt || attempt.status !== 'judging') return

  const resultFields = {
    baselineResult: payload.baselineResult || null,
    baselineScore: payload.baselineScore ?? null,
    candidateResult: payload.candidateResult || null,
    candidateScore: payload.candidateScore ?? null,
    scoreDelta: payload.baselineScore !== undefined && payload.candidateScore !== undefined
      ? payload.baselineScore - payload.candidateScore : null,
    affectedSubtaskIds: payload.affectedSubtaskIds?.length ? JSON.stringify(payload.affectedSubtaskIds) : null,
  }
  if (payload.outcome !== 'accepted') {
    await prisma.problemHackAttempt.update({
      where: { id: attempt.id },
      data: { status: payload.outcome, canonicalStatus: payload.outcome === 'rejected' ? 'rejected' : 'failed', ...resultFields, failureStage: payload.failureStage || null, message: payload.message || null, judgeId: null, judgeStarted: null, finishedAt: new Date() },
    })
    return
  }

  {
    const current = await prisma.problemHackAttempt.findUnique({ where: { id: attempt.id } })
    if (!current || current.status !== 'judging') return
    const [problem, hackConfig] = await Promise.all([
      prisma.problem.findUnique({ where: { id: current.problemId }, include: { LatestTestSetRevision: true } }),
      prisma.problemHackConfig.findUnique({ where: { problemId: current.problemId } }),
    ])
    const mode = hackConfig?.mode === 'oi' ? 'oi' : 'acm'
    if (!problem || !hackConfig || !hackConfig.enabled
      || current.hackConfigRevision !== hackConfig.revision
      || !problem.LatestTestSetRevision
      || current.judgeConfigHash !== problem.LatestTestSetRevision.judgeConfigHash
      || (mode === 'oi' && current.testGraphRevision !== problem.testGraphRevision)) {
      await prisma.problemHackAttempt.update({
        where: { id: current.id },
        data: { status: 'stale', failureStage: 'stale', message: 'Hack 或测试图配置已变化，请重新发起', judgeId: null, judgeStarted: null, finishedAt: new Date() },
      })
      return
    }

    const inputData = payload.inputData || ''
    const outputData = payload.outputData ?? ''
    if (!inputData.trim() || Buffer.byteLength(inputData, 'utf8') > HACK_INPUT_LIMIT || Buffer.byteLength(outputData, 'utf8') > HACK_INPUT_LIMIT) {
      await prisma.problemHackAttempt.update({ where: { id: current.id }, data: { status: 'system_error', failureStage: 'persist', message: 'Judge 返回的 Hack 数据无效或超过 1 MiB', judgeId: null, judgeStarted: null, finishedAt: new Date() } })
      return
    }
    const inputSha256 = crypto.createHash('sha256').update(inputData).digest('hex')
    const outputSha256 = crypto.createHash('sha256').update(outputData).digest('hex')
    if (payload.inputSha256 && payload.inputSha256 !== inputSha256) throw new Error('Hack input hash mismatch')
    if (payload.outputSha256 && payload.outputSha256 !== outputSha256) throw new Error('Hack output hash mismatch')
    if (current.baseTestSetRevisionId !== problem.latestTestSetRevisionId) {
      if (current.promotionRetries < 3) {
        await prisma.problemHackAttempt.update({ where: { id: current.id }, data: {
          status: 'queuing', baseTestSetRevisionId: problem.latestTestSetRevisionId,
          judgeConfigHash: problem.LatestTestSetRevision.judgeConfigHash,
          testGraphRevision: problem.testGraphRevision, promotionRetries: { increment: 1 },
          canonicalStatus: null, failureStage: 'stale', message: '题库测试版本已更新，正在基于最新版重新评测',
          judgeId: null, judgeStarted: null, finishedAt: null,
        } })
      } else {
        await prisma.problemHackAttempt.update({ where: { id: current.id }, data: {
          status: 'stale', canonicalStatus: 'failed', failureStage: 'stale', message: '并发版本变化次数过多，请重新发起 Hack',
          judgeId: null, judgeStarted: null, finishedAt: new Date(),
        } })
      }
      return
    }

    // Only inputs that are part of the current formal revision are duplicates.
    // An orphan object or an answer file may legitimately have the same bytes.
    const duplicate = await prisma.testdataObject.findFirst({ where: {
      problemId: current.problemId,
      sha256: inputSha256,
      OR: [
        { AcmInputs: { some: { revisionId: problem.latestTestSetRevisionId! } } },
        { GroupInputs: { some: { revisionId: problem.latestTestSetRevisionId! } } },
      ],
    } })
    if (duplicate) {
      await prisma.problemHackAttempt.update({
        where: { id: current.id },
        data: { status: 'rejected', canonicalStatus: 'redundant', ...resultFields, failureStage: 'input', message: '候选输入与已有正式测试数据重复', inputSha256, judgeId: null, judgeStarted: null, finishedAt: new Date() },
      })
      return
    }

    const affected = payload.affectedSubtaskIds || []
    if (mode === 'oi' && affected.length === 0) throw new Error('OI Hack missing affected subtasks')
    const inputFile = `hack_${current.id}.in`, outputFile = `hack_${current.id}.out`
    const inputFileId = crypto.randomUUID(), outputFileId = crypto.randomUUID()
    const testcaseId = crypto.randomUUID()
    const nextRevision = problem.testGraphRevision + 1

    const directory = problemDirectory(current.problemId)
    await fs.promises.mkdir(directory, { recursive: true })
    const stagedInput = path.join(directory, `.${inputFile}.pending`), stagedOutput = path.join(directory, `.${outputFile}.pending`)
    const finalInput = path.join(directory, inputFile), finalOutput = path.join(directory, outputFile)
    let inputPromoted = false, outputPromoted = false, testcaseCreated = false, revisionPublished = false
    try {
      await fs.promises.writeFile(stagedInput, inputData, { encoding: 'utf8', flag: 'wx' })
      await fs.promises.writeFile(stagedOutput, outputData, { encoding: 'utf8', flag: 'wx' })
      await fs.promises.rename(stagedInput, finalInput); inputPromoted = true
      await fs.promises.rename(stagedOutput, finalOutput); outputPromoted = true
      const [inputObject, outputObject] = await Promise.all([
        ingestTestdataObject(problem.id, Buffer.from(inputData)),
        ingestTestdataObject(problem.id, Buffer.from(outputData)),
      ])
      await prisma.$transaction(async tx => {
        const rows = [
          { id: inputFileId, problemId: problem.id, filename: inputFile, size: Buffer.byteLength(inputData), md5: crypto.createHash('md5').update(inputData).digest('hex'), sha256: inputSha256 },
          { id: outputFileId, problemId: problem.id, filename: outputFile, size: Buffer.byteLength(outputData), md5: crypto.createHash('md5').update(outputData).digest('hex'), sha256: outputSha256 },
        ]
        await tx.testdataFile.createMany({ data: rows })
        await tx.problemTestcase.create({ data: { id: testcaseId, problemId: problem.id, inputFileId, outputFileId, source: 'hack', hackerId: current.userId, hackAttemptId: current.id, inputSha256, outputSha256, orderIndex: 0 } })
        return rows
      })
      testcaseCreated = true

      const baseSpec = await loadRevisionSpec(problem.latestTestSetRevisionId!)
      if (!baseSpec || baseSpec.mode !== mode) throw new Error('Hack 基础测试版本不存在或模式不一致')
      const candidateCase = {
        testcaseId, inputName: inputFile, outputName: outputFile,
        inputObjectId: inputObject.id, outputObjectId: outputObject.id,
        source: 'hack', score: mode === 'oi' ? 100 : null,
      }
      if (mode === 'acm') {
        const existing = baseSpec.cases || []
        baseSpec.cases = [...existing.filter(item => item.source === 'hack'), candidateCase, ...existing.filter(item => item.source !== 'hack')]
      } else {
        const affectedSet = new Set(affected)
        for (const subtask of baseSpec.subtasks || []) {
          if (!affectedSet.has(subtask.id)) continue
          const gate = subtask.groups.find(group => group.kind === 'hack_gate')
          if (!gate) throw new Error(`Subtask ${subtask.id} 缺少 Hack Gate`)
          gate.cases = [candidateCase, ...gate.cases]
        }
      }
      const promoted = await publishTestSetRevision({
        problemId: problem.id, expectedLatestRevisionId: problem.latestTestSetRevisionId,
        source: 'hack', createdBy: current.userId, hackAttemptId: current.id,
        baseConfigText: problem.LatestTestSetRevision.judgeConfig, spec: baseSpec,
      })
      revisionPublished = true
      await prisma.problemHackAttempt.update({
        where: { id: current.id },
        data: {
          status: 'accepted', canonicalStatus: 'promoted', ...resultFields, failureStage: null,
          message: `${payload.message || '有效 Hack'}；已从 R${problem.LatestTestSetRevision.revisionNumber} 自动晋升为 R${promoted!.revisionNumber}`, inputSha256, outputSha256,
          acceptedInputFile: inputFile, acceptedOutputFile: outputFile, acceptedTestcaseId: testcaseId,
          candidateTestcaseId: testcaseId, promotedRevisionId: promoted!.id, testGraphRevision: nextRevision,
          judgeId: null, judgeStarted: null, finishedAt: new Date(),
        },
      })
    } catch (error) {
      if (revisionPublished) throw error
      if (error instanceof TestSetRevisionConflict && current.promotionRetries < 3) {
        const latest = await prisma.problem.findUnique({ where: { id: problem.id }, include: { LatestTestSetRevision: true } })
        if (latest?.LatestTestSetRevision) await prisma.problemHackAttempt.update({ where: { id: current.id }, data: {
          status: 'queuing', baseTestSetRevisionId: latest.latestTestSetRevisionId,
          judgeConfigHash: latest.LatestTestSetRevision.judgeConfigHash,
          testGraphRevision: latest.testGraphRevision, promotionRetries: { increment: 1 },
          canonicalStatus: null, failureStage: 'stale', message: '并发 Hack 已生成新版本，正在重新评测',
          judgeId: null, judgeStarted: null, finishedAt: null,
        } })
      }
      if (testcaseCreated) await prisma.problemTestcase.deleteMany({ where: { id: testcaseId } }).catch(() => {})
      await prisma.testdataFile.deleteMany({ where: { id: { in: [inputFileId, outputFileId] } } }).catch(() => {})
      await Promise.allSettled([
        fs.promises.rm(stagedInput, { force: true }), fs.promises.rm(stagedOutput, { force: true }),
        ...(inputPromoted ? [fs.promises.rm(finalInput, { force: true })] : []),
        ...(outputPromoted ? [fs.promises.rm(finalOutput, { force: true })] : []),
      ])
      if (error instanceof TestSetRevisionConflict) return
      throw error
    }
  }
}
