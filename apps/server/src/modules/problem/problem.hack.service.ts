import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { prisma } from '../../prisma'
import { loadTestSetSlotSpec, releaseTestSetReader } from './problem.testset-slot.service'
import {
  createValidatedHackCandidate,
  setCandidateStatus,
} from './problem.testcase-candidate.service'
import { transitionHackAttempt, updateHackAttemptMetadata } from './problem.hack-state'
import { OI_CANDIDATE_LIMITS, uniqueSubtaskCases } from './problem.oi-candidate-policy'
import { queueCandidateEvaluation } from './problem.candidate-evaluation.service'
import { maybeAutoSelectCandidate } from './problem.candidate-selector.service'

export const HACK_SOURCE_LIMIT = 256 * 1024
export const HACK_INPUT_LIMIT = 16 * 1024 * 1024
const HACK_TARGET_LANGUAGES = new Set(['c', 'c11', 'cpp', 'cpp11', 'cpp14', 'cpp17', 'cpp20', 'python3'])

const TESTDATA_ROOT = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')

export function serializeHackAttempt(attempt: any, includePrivate: boolean) {
  const data: Record<string, any> = {
    id: attempt.id,
    problemId: attempt.problemId,
    userId: attempt.userId,
    username: attempt.User?.username,
    contributionOrganizationId: attempt.contributionOrganizationId ?? null,
    contributionOrganizationName: attempt.ContributionOrganization?.name ?? null,
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
    baseSlot: attempt.baseSlot,
    baseGraphHash: attempt.baseGraphHash,
    baseFencingToken: attempt.baseFencingToken,
    candidateTestcaseId: attempt.candidateTestcaseId,
    promotedGraphHash: attempt.promotedGraphHash,
    canonicalStatus: attempt.canonicalStatus,
    testcaseCandidateId: attempt.Candidate?.id ?? null,
    testcaseCandidateStatus: attempt.Candidate?.status ?? null,
    promotionRetries: attempt.promotionRetries,
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
    data.inputFilename = attempt.inputFilename
    data.outputFilename = attempt.outputFilename
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

export async function finalizeHackResult(
  payload: HackJudgeResultPayload,
  owner: { judgeId?: string } = {},
): Promise<void> {
  const claimed = await transitionHackAttempt(prisma, {
    id: payload.hackAttemptId,
    from: 'judging',
    to: 'finalizing',
    judgeId: owner.judgeId,
  })
  if (claimed.count !== 1) return
  const attempt = await prisma.problemHackAttempt.findUnique({ where: { id: payload.hackAttemptId } })
  if (!attempt || attempt.status !== 'finalizing') return

  try {
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
      await transitionHackAttempt(prisma, {
        id: attempt.id,
        from: 'finalizing',
        to: payload.outcome,
        data: {
          canonicalStatus: payload.outcome === 'rejected' ? 'rejected' : 'failed',
          ...resultFields,
          failureStage: payload.failureStage || null,
          message: payload.message || null,
          judgeId: null,
          judgeStarted: null,
          finishedAt: new Date(),
        },
      })
      return
    }

    const [current, problem, hackConfig, evolving] = await Promise.all([
      prisma.problemHackAttempt.findUnique({ where: { id: attempt.id } }),
      prisma.problem.findUnique({ where: { id: attempt.problemId } }),
      prisma.problemHackConfig.findUnique({ where: { problemId: attempt.problemId } }),
      prisma.problemTestSetSlot.findUnique({
        where: { problemId_slot: { problemId: attempt.problemId, slot: 'EVOLVING' } },
      }),
    ])
    if (!current || current.status !== 'finalizing') return
    const mode = hackConfig?.mode === 'oi' ? 'oi' : 'acm'
    const stale = !problem || !hackConfig || !hackConfig.enabled || !evolving
      || current.hackConfigRevision !== hackConfig.revision
      || current.baseSlot !== 'EVOLVING'
      || current.baseGraphHash !== evolving.graphHash
      || current.baseFencingToken !== evolving.fencingToken
      || current.judgeConfigHash !== evolving.judgeConfigHash
      || (mode === 'oi' && current.testGraphRevision !== problem.testGraphRevision)
    if (stale) {
      await transitionHackAttempt(prisma, {
        id: current.id,
        from: 'finalizing',
        to: 'stale',
        data: {
          failureStage: 'stale',
          message: 'Hack 使用的 Evolving 数据已变化，请重新发起',
          judgeId: null,
          judgeStarted: null,
          finishedAt: new Date(),
        },
      })
      return
    }

    const inputData = payload.inputData || ''
    const outputData = payload.outputData ?? ''
    if (!inputData.trim() || Buffer.byteLength(inputData, 'utf8') > HACK_INPUT_LIMIT || Buffer.byteLength(outputData, 'utf8') > HACK_INPUT_LIMIT) {
      await transitionHackAttempt(prisma, {
        id: current.id,
        from: 'finalizing',
        to: 'system_error',
        data: {
          failureStage: 'persist',
          message: 'Judge 返回的 Hack 数据无效或超过 16 MiB',
          judgeId: null,
          judgeStarted: null,
          finishedAt: new Date(),
        },
      })
      return
    }

    const inputSha256 = crypto.createHash('sha256').update(inputData).digest('hex')
    const outputSha256 = crypto.createHash('sha256').update(outputData).digest('hex')
    if (payload.inputSha256 && payload.inputSha256 !== inputSha256) throw new Error('Hack input hash mismatch')
    if (payload.outputSha256 && payload.outputSha256 !== outputSha256) throw new Error('Hack output hash mismatch')

    const duplicate = await prisma.testdataObject.findFirst({
      where: {
        problemId: current.problemId,
        sha256: inputSha256,
        OR: [
          { SlotCaseInputs: { some: { problemId: current.problemId, slot: 'EVOLVING' } } },
          { SlotGroupInputs: { some: { problemId: current.problemId, slot: 'EVOLVING' } } },
        ],
      },
    })
    const affected = payload.affectedSubtaskIds || []
    if (mode === 'oi' && affected.length === 0) throw new Error('OI Hack missing affected subtasks')
    const candidate = await createValidatedHackCandidate({
      problemId: current.problemId,
      hackAttemptId: current.id,
      createdBy: current.userId,
      contributionOrganizationId: current.contributionOrganizationId,
      baseSlot: 'EVOLVING',
      baseGraphHash: evolving.graphHash,
      baseFencingToken: evolving.fencingToken,
      input: Buffer.from(inputData),
      output: Buffer.from(outputData),
      inputFileName: `hack_${current.id}.in`,
      outputFileName: `hack_${current.id}.out`,
      affectedSubtaskIds: affected,
      canonicalDuplicate: Boolean(duplicate),
    })

    if (duplicate) {
      await Promise.all([
        setCandidateStatus(candidate.id, 'REDUNDANT', '候选输入与当前 Evolving 数据重复'),
        transitionHackAttempt(prisma, {
          id: current.id,
          from: 'finalizing',
          to: 'rejected',
          data: {
            canonicalStatus: 'redundant',
            ...resultFields,
            failureStage: 'input',
            message: '候选输入与当前 Evolving 数据重复',
            inputSha256,
            outputSha256,
            judgeId: null,
            judgeStarted: null,
            finishedAt: new Date(),
          },
        }),
      ])
      return
    }

    const currentSpec = await loadTestSetSlotSpec(current.problemId, 'EVOLVING')
    const subtaskCapacity = mode === 'oi'
      ? (currentSpec?.subtasks || [])
        .filter(subtask => affected.includes(subtask.id))
        .map(subtask => ({
          subtaskId: subtask.id,
          caseCount: uniqueSubtaskCases(subtask).length,
          caseLimit: OI_CANDIDATE_LIMITS.MAX_CASES_PER_SUBTASK,
        }))
      : []
    const requiresReplacement = mode === 'acm'
      ? currentSpec?.mode === 'acm' && (currentSpec.cases?.length || 0) >= 100
      : subtaskCapacity.some(item => item.caseCount >= item.caseLimit)

    await prisma.testcaseCandidate.update({
      where: { id: candidate.id },
      data: {
        status: requiresReplacement ? 'WAITING_REPLACEMENT' : 'ELIGIBLE',
        evaluationStage: mode === 'acm'
          ? (requiresReplacement ? 'waiting_replacement' : 'technical_hack_evidence')
          : 'awaiting_evaluator',
        currentValue: 0,
        marginalValue: 0,
        selectionOutcome: { technicalHackAccepted: true, subtaskCapacity, requiresReplacement },
        protectedUntil: new Date(Date.now() + OI_CANDIDATE_LIMITS.SUCCESSFUL_HACK_PROTECTION_DAYS * 24 * 60 * 60_000),
      },
    })
    await transitionHackAttempt(prisma, {
      id: current.id,
      from: 'finalizing',
      to: 'accepted',
      data: {
        canonicalStatus: 'pending',
        ...resultFields,
        failureStage: null,
        message: requiresReplacement
          ? `${payload.message || '有效 Hack'}；当前测试点已满，候选数据等待 Selector 执行有界替换`
          : `${payload.message || '有效 Hack'}；候选数据已进入 Evolving 评估队列，技术成功不代表已采用`,
        inputSha256,
        outputSha256,
        candidateTestcaseId: candidate.id,
        judgeId: null,
        judgeStarted: null,
        finishedAt: new Date(),
      },
    })
    if (mode === 'oi') await queueCandidateEvaluation(candidate.id).catch(() => undefined)
    else await maybeAutoSelectCandidate(candidate.id).catch(() => undefined)
  } finally {
    if (attempt.testSetReaderId) {
      await releaseTestSetReader(attempt.testSetReaderId).catch(() => undefined)
      await updateHackAttemptMetadata(prisma, {
        id: attempt.id,
        where: { testSetReaderId: attempt.testSetReaderId },
        data: { testSetReaderId: null },
      }).catch(() => undefined)
    }
  }
}
