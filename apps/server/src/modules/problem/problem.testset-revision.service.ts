import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { getTestdataBlobStore, problemBlobKey } from '../storage/blob-store'
import { validateOiFormalLimits } from './problem.oi-candidate-policy'

const TESTDATA_ROOT = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')

export type RevisionCaseSpec = {
  testcaseId?: string | null
  inputName: string
  outputName: string
  inputObjectId: string
  outputObjectId: string
  source: string
  score?: number | null
  time?: string | null
  memory?: string | null
}

export type RevisionGroupSpec = {
  key: string
  name: string
  kind: 'official' | 'hack_gate'
  score: number
  type: 'min' | 'max' | 'sum'
  cases: RevisionCaseSpec[]
}

export type RevisionSubtaskSpec = {
  id: number
  score: number
  if: number[]
  groups: RevisionGroupSpec[]
}

export type TestSetRevisionSpec = {
  mode: 'acm' | 'oi'
  cases?: RevisionCaseSpec[]
  subtasks?: RevisionSubtaskSpec[]
}

export class TestSetRevisionConflict extends Error {
  code = 'TEST_SET_REVISION_STALE'
  constructor() {
    super('题目测试版本已变化，请刷新后重试')
  }
}

export class TestSetRevisionValidationError extends Error {
  statusCode = 422
  code: string
  issues: ReturnType<typeof validateOiFormalLimits>
  constructor(issues: ReturnType<typeof validateOiFormalLimits>) {
    super(issues[0]?.message || '正式测试版本不符合约束')
    this.code = issues[0]?.code || 'INVALID_TEST_SET_REVISION'
    this.issues = issues
  }
}

export class TestSetRevisionLimitError extends Error {
  statusCode = 409
  code = 'TEST_SET_REVISION_LIMIT_REACHED'
  constructor() { super('该题已达到 10000 个正式测试版本的硬上限，必须由平台管理员先完成审计') }
}

export class TestSetCaseLimitError extends Error {
  statusCode = 422
  code = 'ACM_CASE_LIMIT_REACHED'
  constructor() { super('ACM 正式测试版本最多允许 100 个唯一测试点；满额后必须通过 Selector 替换') }
}

function problemRoot(problemId: string) {
  const root = path.resolve(TESTDATA_ROOT)
  const target = path.resolve(root, problemId)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Invalid problem testdata path')
  return target
}

function safeLogicalName(value: string) {
  const name = path.basename(String(value || ''))
  if (!name || name !== value || name === '.' || name === '..') throw new Error(`非法测试数据文件名：${value}`)
  return name
}

function sha256(content: Buffer | string) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function stableHash(value: unknown) {
  return sha256(JSON.stringify(value))
}

export async function acquireProblemMutationLock(tx: Prisma.TransactionClient, problemId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${problemId}, 0)) IS NULL AS locked`
}

async function writeObjectFile(problemId: string, digest: string, content: Buffer) {
  const storageKey = `objects/${digest}`
  await getTestdataBlobStore().put(problemBlobKey(problemId, storageKey), content, { ifAbsent: true })
  return storageKey
}

export async function ingestTestdataObject(problemId: string, content: Buffer) {
  const digest = sha256(content)
  const storageKey = await writeObjectFile(problemId, digest, content)
  try {
    return await prisma.testdataObject.upsert({
      where: { problemId_sha256: { problemId, sha256: digest } },
      update: {},
      create: { id: crypto.randomUUID(), problemId, sha256: digest, size: content.length, storageKey },
    })
  } catch (error: any) {
    // Concurrent ingestion of identical input/output bytes may race between
    // the upsert's read and insert phases. The winner is the canonical row.
    if (error?.code !== 'P2002') throw error
    return prisma.testdataObject.findUniqueOrThrow({ where: { problemId_sha256: { problemId, sha256: digest } } })
  }
}

async function resolveCurrentFile(problemId: string, fileId: string) {
  const file = await prisma.testdataFile.findFirst({ where: { id: fileId, problemId } })
  if (!file) throw new Error('测试数据文件不存在或不属于当前题目')
  const target = path.join(problemRoot(problemId), safeLogicalName(file.filename))
  const content = await fs.promises.readFile(target)
  const object = await ingestTestdataObject(problemId, content)
  return { file, object }
}

async function resolveNamedPair(problemId: string, inputName: string, outputName: string) {
  const names = [safeLogicalName(inputName), safeLogicalName(outputName)]
  const files = await prisma.testdataFile.findMany({ where: { problemId, filename: { in: names } } })
  const byName = new Map(files.map(file => [file.filename, file]))
  const input = byName.get(names[0]), output = byName.get(names[1])
  if (!input || !output) throw new Error(`测试数据文件缺失：${!input ? names[0] : names[1]}`)
  const [inputResolved, outputResolved] = await Promise.all([
    resolveCurrentFile(problemId, input.id),
    resolveCurrentFile(problemId, output.id),
  ])
  const testcase = await prisma.problemTestcase.upsert({
    where: { problemId_inputFileId_outputFileId: { problemId, inputFileId: input.id, outputFileId: output.id } },
    update: { enabled: true, inputSha256: inputResolved.object.sha256, outputSha256: outputResolved.object.sha256 },
    create: {
      id: crypto.randomUUID(), problemId, inputFileId: input.id, outputFileId: output.id,
      source: /^hack_[0-9a-f-]+\.in$/i.test(input.filename) ? 'hack' : 'official',
      inputSha256: inputResolved.object.sha256, outputSha256: outputResolved.object.sha256,
    },
  })
  return {
    testcaseId: testcase.id,
    inputName: input.filename,
    outputName: output.filename,
    inputObjectId: inputResolved.object.id,
    outputObjectId: outputResolved.object.id,
    source: testcase.source,
  } satisfies RevisionCaseSpec
}

export async function resolveGraphDraft(problemId: string, input: any): Promise<TestSetRevisionSpec> {
  const subtasks = Array.isArray(input?.subtasks) ? input.subtasks : []
  const testcaseIds = [...new Set<string>(subtasks.flatMap((subtask: any) => (subtask.groups || [])
    .flatMap((group: any) => (group.cases || []).map((item: any) => String(item.testcaseId || '')))).filter(Boolean))]
  const testcases = await prisma.problemTestcase.findMany({
    where: { problemId, id: { in: testcaseIds } },
    include: { InputFile: true, OutputFile: true },
  })
  if (testcases.length !== testcaseIds.length) throw new Error('存在不属于当前题目的 Testcase')
  const resolved = new Map<string, RevisionCaseSpec>()
  await Promise.all(testcases.map(async testcase => {
    const [inputFile, outputFile] = await Promise.all([
      resolveCurrentFile(problemId, testcase.inputFileId),
      resolveCurrentFile(problemId, testcase.outputFileId),
    ])
    resolved.set(testcase.id, {
      testcaseId: testcase.id,
      inputName: testcase.InputFile.filename,
      outputName: testcase.OutputFile.filename,
      inputObjectId: inputFile.object.id,
      outputObjectId: outputFile.object.id,
      source: testcase.source,
    })
  }))
  return {
    mode: 'oi',
    subtasks: subtasks.map((subtask: any) => ({
      id: Number(subtask.id), score: Number(subtask.score), if: (subtask.if || []).map(Number),
      groups: (subtask.groups || []).map((group: any) => ({
        key: String(group.key), name: String(group.name || group.key), kind: group.kind,
        score: Number(group.score || 0), type: group.type,
        cases: (group.cases || []).map((item: any) => ({
          ...resolved.get(String(item.testcaseId))!,
          score: item.score ?? null, time: item.time || null, memory: item.memory || null,
        })),
      })),
    })),
  }
}

function parseConfig(text: string | null | undefined): Record<string, any> {
  if (!text?.trim()) return {}
  const value = yaml.load(text)
  return value && typeof value === 'object' ? value as Record<string, any> : {}
}

function normalizeLegacySubtaskIds(rawSubtasks: any[]) {
  const used = new Set<number>()
  const byLegacyKey = new Map<string, number>()
  const ids: number[] = []
  let nextId = 1

  for (const [index, raw] of rawSubtasks.entries()) {
    const legacyValue = raw?.id ?? index + 1
    const legacyKey = String(legacyValue)
    if (byLegacyKey.has(legacyKey)) throw new Error(`OI Subtask ID 重复：${legacyKey}`)

    const numeric = Number(legacyValue)
    let id = Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null
    if (id != null && used.has(id)) throw new Error(`OI Subtask ID 重复：${legacyKey}`)
    if (id == null) {
      while (used.has(nextId)) nextId++
      id = nextId
    }
    used.add(id)
    byLegacyKey.set(legacyKey, id)
    ids.push(id)
  }

  return {
    ids,
    dependencyIds(rawDependencies: unknown) {
      return (Array.isArray(rawDependencies) ? rawDependencies : []).map(value => {
        const id = byLegacyKey.get(String(value))
        if (id == null) throw new Error(`OI Subtask 依赖不存在：${String(value)}`)
        return id
      })
    },
  }
}

export async function resolveConfigSpec(problemId: string, configText: string): Promise<TestSetRevisionSpec> {
  const config = parseConfig(configText)
  const mode = config.mode === 'oi' || (config.mode !== 'acm' && Array.isArray(config.subtasks) && config.subtasks.length > 0) ? 'oi' : 'acm'
  if (mode === 'acm') {
    const cases = Array.isArray(config.cases) ? config.cases : []
    return {
      mode,
      cases: await Promise.all(cases.map(async (item: any) => {
        const normalized = normalizeLegacyCase(item)
        return {
          ...await resolveNamedPair(problemId, normalized.input, normalized.output),
          score: normalized.score ?? null, time: normalized.time || null, memory: normalized.memory || null,
        }
      })),
    }
  }
  const rawSubtasks = Array.isArray(config.subtasks) ? config.subtasks : []
  const normalizedIds = normalizeLegacySubtaskIds(rawSubtasks)
  const subtasks: RevisionSubtaskSpec[] = []
  for (const [index, raw] of rawSubtasks.entries()) {
    const id = normalizedIds.ids[index]
    const rawGroups = Array.isArray(raw.groups) && raw.groups.length > 0
      ? raw.groups
      : [
          { id: `official-${id}`, name: '官方测试组', kind: 'official', score: Number(raw.score || 0), type: raw.type || raw.scoring || 'min', cases: raw.cases || [] },
          { id: 'hack-gate', name: 'Hack 得分门槛', kind: 'hack_gate', score: 0, type: 'min', cases: [] },
        ]
    const groups: RevisionGroupSpec[] = []
    for (const group of rawGroups) {
      groups.push({
        key: String(group.id || group.key), name: String(group.name || group.id || group.key), kind: group.kind === 'hack_gate' ? 'hack_gate' : 'official',
        score: Number(group.score || 0), type: ['max', 'sum'].includes(group.type) ? group.type : 'min',
        cases: await Promise.all((group.cases || []).map(async (item: any) => {
          const normalized = normalizeLegacyCase(item)
          return {
            ...await resolveNamedPair(problemId, normalized.input, normalized.output),
            score: normalized.score ?? null, time: normalized.time || null, memory: normalized.memory || null,
          }
        })),
      })
    }
    subtasks.push({ id, score: Number(raw.score || 0), if: normalizedIds.dependencyIds(raw.if), groups })
  }
  return { mode, subtasks }
}

function normalizeLegacyCase(item: any): { input: string; output: string; score?: number; time?: string; memory?: string } {
  if ((typeof item === 'number' && Number.isInteger(item) && item > 0) || (typeof item === 'string' && /^\d+$/.test(item))) {
    return { input: `${item}.in`, output: `${item}.ans` }
  }
  if (!item || typeof item !== 'object' || typeof item.input !== 'string' || typeof item.output !== 'string') {
    throw new Error('测试点缺少输入文件名或答案文件名')
  }
  return item
}

function projectRevisionConfig(baseConfigText: string | null, spec: TestSetRevisionSpec) {
  const base = parseConfig(baseConfigText)
  if (spec.mode === 'acm') {
    const config: Record<string, any> = {
      ...base,
      mode: 'acm',
      cases: (spec.cases || []).map(item => ({
        input: item.inputName, output: item.outputName,
        ...(item.score == null ? {} : { score: item.score }),
        ...(item.time ? { time: item.time } : {}),
        ...(item.memory ? { memory: item.memory } : {}),
      })),
    }
    delete config.subtasks
    return yaml.dump(config, { lineWidth: -1 })
  }
  const config: Record<string, any> = {
    ...base,
    mode: 'oi',
    subtasks: (spec.subtasks || []).map(subtask => ({
      id: subtask.id, score: subtask.score, if: subtask.if,
      groups: subtask.groups.map(group => ({
        id: group.key, name: group.name, kind: group.kind, score: group.score, type: group.type,
        cases: group.cases.map(item => ({
          input: item.inputName, output: item.outputName,
          ...(item.score == null ? {} : { score: item.score }),
          ...(item.time ? { time: item.time } : {}),
          ...(item.memory ? { memory: item.memory } : {}),
        })),
      })),
    })),
  }
  delete config.cases
  return yaml.dump(config, { lineWidth: -1 })
}

function configuredAssetNames(configText: string) {
  const config = parseConfig(configText)
  const names = new Set<string>()
  for (const key of ['checker', 'interactor', 'manager'] as const) {
    const value = config[key]
    const file = typeof value === 'string' ? value : value && typeof value === 'object' ? value.file : null
    if (typeof file === 'string' && file.trim()) names.add(safeLogicalName(file.trim()))
  }
  return [...names]
}

async function materializeRevision(problemId: string, revisionId: string, spec: TestSetRevisionSpec, judgeConfig: string) {
  const root = problemRoot(problemId)
  const revisionsRoot = path.join(root, 'revisions')
  const pending = path.join(revisionsRoot, `.${revisionId}.pending`)
  const final = path.join(revisionsRoot, revisionId)
  await fs.promises.mkdir(pending, { recursive: true })
  try {
    const allCases = spec.mode === 'acm' ? spec.cases || [] : (spec.subtasks || []).flatMap(subtask => subtask.groups.flatMap(group => group.cases))
    const objectIds = [...new Set(allCases.flatMap(item => [item.inputObjectId, item.outputObjectId]))]
    const objects = await prisma.testdataObject.findMany({ where: { problemId, id: { in: objectIds } } })
    if (objects.length !== objectIds.length) throw new Error('Revision 引用了不存在的测试数据对象')
    const byId = new Map(objects.map(item => [item.id, item]))
    const targets = new Map<string, string>()
    for (const item of allCases) {
      for (const [nameValue, objectId] of [[item.inputName, item.inputObjectId], [item.outputName, item.outputObjectId]] as const) {
        const name = safeLogicalName(nameValue)
        const object = byId.get(objectId)!
        const previous = targets.get(name)
        if (previous && previous !== object.sha256) throw new Error(`Revision 内文件名冲突：${name}`)
        targets.set(name, object.sha256)
        const target = path.join(pending, name)
        if (fs.existsSync(target)) continue
        await getTestdataBlobStore().materialize(problemBlobKey(problemId, object.storageKey), target)
      }
    }
    // Checker / interactor / manager are part of the executable test set.  Pin
    // file-backed assets beside the cases so later replacements cannot mutate
    // historical revisions.
    for (const name of configuredAssetNames(judgeConfig)) {
      const source = path.join(root, name)
      const target = path.join(pending, name)
      await fs.promises.access(source, fs.constants.R_OK).catch(() => {
        throw new Error(`评测资产文件缺失：${name}`)
      })
      // Unlike content-addressed objects, the problem-root asset is mutable.
      // A hard link would let an in-place editor rewrite historical revisions.
      if (!fs.existsSync(target)) await fs.promises.copyFile(source, target)
    }
    await fs.promises.mkdir(revisionsRoot, { recursive: true })
    await fs.promises.rename(pending, final)
    return { relativePath: path.relative(root, final), absolutePath: final }
  } catch (error) {
    await fs.promises.rm(pending, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function removeRevisionDirectory(problemId: string, revisionId: string) {
  const target = path.join(problemRoot(problemId), 'revisions', revisionId)
  await fs.promises.rm(target, { recursive: true, force: true })
}

export async function publishTestSetRevision(params: {
  problemId: string
  expectedLatestRevisionId: string | null
  source: 'initial' | 'admin_edit' | 'hack' | 'mode_transition'
  createdBy?: string | null
  hackAttemptId?: string | null
  baseConfigText: string | null
  spec: TestSetRevisionSpec
  transactionHook?: (tx: Prisma.TransactionClient, revision: { id: string; revisionNumber: number; judgeConfig: string }) => Promise<void>
}) {
  if (params.spec.mode === 'acm') {
    const uniqueCases = new Set((params.spec.cases || []).map(item => item.testcaseId || `${item.inputObjectId}\0${item.outputObjectId}`))
    if (uniqueCases.size > 100) throw new TestSetCaseLimitError()
  }
  const formalLimitIssues = validateOiFormalLimits(params.spec)
  if (formalLimitIssues.length) throw new TestSetRevisionValidationError(formalLimitIssues)
  const revisionId = crypto.randomUUID()
  const judgeConfig = projectRevisionConfig(params.baseConfigText, params.spec)
  const graphHash = stableHash(params.spec)
  const judgeConfigHash = sha256(judgeConfig)
  const materialized = await materializeRevision(params.problemId, revisionId, params.spec, judgeConfig)
  let published: Awaited<ReturnType<typeof prisma.problemTestSetRevision.findUnique>>
  try {
    published = await prisma.$transaction(async tx => {
      await acquireProblemMutationLock(tx, params.problemId)
      const problem = await tx.problem.findUnique({ where: { id: params.problemId }, select: { latestTestSetRevisionId: true } })
      if (!problem || problem.latestTestSetRevisionId !== params.expectedLatestRevisionId) throw new TestSetRevisionConflict()
      const last = await tx.problemTestSetRevision.aggregate({ where: { problemId: params.problemId }, _max: { revisionNumber: true } })
      if ((last._max.revisionNumber || 0) >= 10_000) throw new TestSetRevisionLimitError()
      const revisionNumber = (last._max.revisionNumber || 0) + 1
      await tx.problemTestSetRevision.create({
        data: {
          id: revisionId, problemId: params.problemId, revisionNumber,
          parentRevisionId: params.expectedLatestRevisionId, mode: params.spec.mode, source: params.source,
          judgeConfig, judgeConfigHash, graphHash, testdataPath: materialized.relativePath,
          createdBy: params.createdBy || null, hackAttemptId: params.hackAttemptId || null,
        },
      })
      if (params.spec.mode === 'acm') {
        for (const [orderIndex, item] of (params.spec.cases || []).entries()) {
          await tx.problemTestSetRevisionCase.create({ data: {
            id: crypto.randomUUID(), revisionId, testcaseId: item.testcaseId || null,
            inputObjectId: item.inputObjectId, outputObjectId: item.outputObjectId,
            inputName: item.inputName, outputName: item.outputName, orderIndex,
            score: item.score ?? null, time: item.time || null, memory: item.memory || null, source: item.source,
          } })
        }
      } else {
        const subtaskIds = new Map<number, string>()
        for (const [orderIndex, subtask] of (params.spec.subtasks || []).entries()) {
          const subtaskDbId = crypto.randomUUID(); subtaskIds.set(subtask.id, subtaskDbId)
          await tx.problemTestSetRevisionSubtask.create({ data: { id: subtaskDbId, revisionId, subtaskId: subtask.id, score: subtask.score, orderIndex } })
          for (const [groupIndex, group] of subtask.groups.entries()) {
            const groupId = crypto.randomUUID()
            await tx.problemTestSetRevisionGroup.create({ data: {
              id: groupId, revisionId, subtaskId: subtaskDbId, key: group.key, name: group.name,
              kind: group.kind, score: group.score, aggregation: group.type, orderIndex: groupIndex,
            } })
            for (const [caseIndex, item] of group.cases.entries()) await tx.problemTestSetRevisionGroupCase.create({ data: {
              id: crypto.randomUUID(), revisionId, groupId, testcaseId: item.testcaseId || null,
              inputObjectId: item.inputObjectId, outputObjectId: item.outputObjectId,
              inputName: item.inputName, outputName: item.outputName, orderIndex: caseIndex,
              score: item.score ?? null, time: item.time || null, memory: item.memory || null, source: item.source,
            } })
          }
        }
        for (const subtask of params.spec.subtasks || []) for (const dependency of subtask.if) {
          await tx.problemTestSetRevisionDependency.create({ data: {
            id: crypto.randomUUID(), subtaskId: subtaskIds.get(subtask.id)!, dependsOnId: subtaskIds.get(dependency)!,
          } })
        }
      }
      const changed = await tx.problem.updateMany({
        where: { id: params.problemId, latestTestSetRevisionId: params.expectedLatestRevisionId },
        data: { latestTestSetRevisionId: revisionId, judgeConfig, testGraphRevision: { increment: 1 } },
      })
      if (changed.count !== 1) throw new TestSetRevisionConflict()
      if (params.transactionHook) await params.transactionHook(tx, { id: revisionId, revisionNumber, judgeConfig })
      return tx.problemTestSetRevision.findUnique({ where: { id: revisionId } })
    }, { timeout: 30_000 })
  } catch (error) {
    await removeRevisionDirectory(params.problemId, revisionId).catch(() => {})
    throw error
  }
  // Quality evaluation is deliberately outside the immutable Revision
  // publication transaction. A missing/empty Wrong Corpus must never roll
  // back a valid test-set release; once the corpus is ready, managers can
  // enqueue the same idempotent pinned evaluation through the quality API.
  if (published && params.createdBy) {
    await import('./problem.quality.service').then(({ enqueueQualityEvaluationForRevision }) =>
      enqueueQualityEvaluationForRevision({ problemId: params.problemId, revisionId: published!.id, createdBy: params.createdBy! }),
    ).catch(() => undefined)
  }
  return published
}

export async function loadRevisionSpec(revisionId: string): Promise<TestSetRevisionSpec | null> {
  const revision = await prisma.problemTestSetRevision.findUnique({
    where: { id: revisionId },
    include: {
      AcmCases: { orderBy: { orderIndex: 'asc' } },
      Subtasks: {
        orderBy: { orderIndex: 'asc' },
        include: {
          Dependencies: { include: { DependsOn: true } },
          Groups: { orderBy: { orderIndex: 'asc' }, include: { Cases: { orderBy: { orderIndex: 'asc' } } } },
        },
      },
    },
  })
  if (!revision) return null
  if (revision.mode === 'acm') return {
    mode: 'acm', cases: revision.AcmCases.map(item => ({
      testcaseId: item.testcaseId, inputName: item.inputName, outputName: item.outputName,
      inputObjectId: item.inputObjectId, outputObjectId: item.outputObjectId, source: item.source,
      score: item.score, time: item.time, memory: item.memory,
    })),
  }
  return {
    mode: 'oi',
    subtasks: revision.Subtasks.map(subtask => ({
      id: subtask.subtaskId, score: subtask.score,
      if: subtask.Dependencies.map(item => item.DependsOn.subtaskId).sort((a, b) => a - b),
      groups: subtask.Groups.map(group => ({
        key: group.key, name: group.name, kind: group.kind as 'official' | 'hack_gate',
        score: group.score, type: group.aggregation as 'min' | 'max' | 'sum',
        cases: group.Cases.map(item => ({
          testcaseId: item.testcaseId, inputName: item.inputName, outputName: item.outputName,
          inputObjectId: item.inputObjectId, outputObjectId: item.outputObjectId, source: item.source,
          score: item.score, time: item.time, memory: item.memory,
        })),
      })),
    })),
  }
}

export async function ensureInitialTestSetRevision(problemId: string, createdBy?: string | null) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId }, select: { judgeConfig: true, latestTestSetRevisionId: true } })
  if (!problem) throw new Error('题目不存在')
  if (problem.latestTestSetRevisionId) return prisma.problemTestSetRevision.findUnique({ where: { id: problem.latestTestSetRevisionId } })
  if (!problem.judgeConfig?.trim()) throw new Error('题目尚未配置本地评测')
  const spec = await resolveConfigSpec(problemId, problem.judgeConfig)
  try {
    return await publishTestSetRevision({
      problemId, expectedLatestRevisionId: null, source: 'initial', createdBy,
      baseConfigText: problem.judgeConfig, spec,
    })
  } catch (error) {
    // Several first submissions may discover the same legacy/unmigrated
    // problem concurrently. The advisory lock and CAS intentionally allow
    // one initial publisher only; all other callers should reuse that winner
    // instead of surfacing a transient 409 to otherwise valid submissions.
    if (!(error instanceof TestSetRevisionConflict)) throw error
    const latest = await prisma.problem.findUnique({
      where: { id: problemId },
      select: { latestTestSetRevisionId: true },
    })
    if (!latest?.latestTestSetRevisionId) throw error
    const revision = await prisma.problemTestSetRevision.findUnique({
      where: { id: latest.latestTestSetRevisionId },
    })
    if (!revision) throw error
    return revision
  }
}

export async function revisionAbsolutePath(problemId: string, revision: { testdataPath: string }) {
  const root = problemRoot(problemId)
  const target = path.resolve(root, revision.testdataPath)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Invalid revision path')
  return target
}

export async function listTestSetRevisions(problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId }, select: { latestTestSetRevisionId: true } })
  if (!problem) return null
  const revisions = await prisma.problemTestSetRevision.findMany({
    where: { problemId }, orderBy: { revisionNumber: 'desc' },
    select: { id: true, revisionNumber: true, parentRevisionId: true, mode: true, source: true, judgeConfigHash: true, graphHash: true, createdBy: true, hackAttemptId: true, createdAt: true },
  })
  return { latestTestSetRevisionId: problem.latestTestSetRevisionId, revisions }
}

export async function loadLatestRevisionGraph(problemId: string) {
  const problem = await prisma.problem.findUnique({
    where: { id: problemId },
    select: { latestTestSetRevisionId: true },
  })
  if (!problem?.latestTestSetRevisionId) return null
  const revision = await prisma.problemTestSetRevision.findUnique({
    where: { id: problem.latestTestSetRevisionId },
    include: {
      Subtasks: {
        orderBy: { orderIndex: 'asc' },
        include: {
          Dependencies: { include: { DependsOn: true } },
          Groups: {
            orderBy: { orderIndex: 'asc' },
            include: { Cases: { orderBy: { orderIndex: 'asc' } } },
          },
        },
      },
    },
  })
  if (!revision || revision.mode !== 'oi') return null
  return {
    revisionId: revision.id,
    revision: revision.revisionNumber,
    source: revision.source,
    createdAt: revision.createdAt,
    migrated: true,
    subtasks: revision.Subtasks.map(subtask => ({
      dbId: subtask.id,
      id: subtask.subtaskId,
      score: subtask.score,
      if: subtask.Dependencies.map(dep => dep.DependsOn.subtaskId).sort((a, b) => a - b),
      groups: subtask.Groups.map(group => ({
        id: group.id,
        key: group.key,
        name: group.name,
        kind: group.kind,
        score: group.score,
        type: group.aggregation,
        cases: group.Cases.map(link => ({
          testcaseId: link.testcaseId,
          input: link.inputName,
          output: link.outputName,
          source: link.source,
          score: link.score,
          time: link.time,
          memory: link.memory,
        })),
      })),
    })),
  }
}

export async function transitionJudgeMode(params: {
  problemId: string
  targetMode: 'acm' | 'oi'
  expectedLatestRevisionId: string
  updatedBy: string
}) {
  const problem = await prisma.problem.findUnique({ where: { id: params.problemId }, include: { LatestTestSetRevision: true } })
  if (!problem?.LatestTestSetRevision) throw new Error('题目尚无正式测试版本')
  if (problem.latestTestSetRevisionId !== params.expectedLatestRevisionId) throw new TestSetRevisionConflict()
  if (problem.LatestTestSetRevision.mode === params.targetMode) return problem.LatestTestSetRevision
  const current = await loadRevisionSpec(problem.LatestTestSetRevision.id)
  if (!current) throw new Error('当前正式测试版本不存在')
  let spec: TestSetRevisionSpec
  if (params.targetMode === 'oi') {
    const cases = current.mode === 'acm' ? current.cases || [] : []
    if (cases.length === 0) throw new Error('ACM 测试版本没有可转换的测试点')
    spec = { mode: 'oi', subtasks: [{ id: 1, score: 100, if: [], groups: [
      { key: 'official-1', name: '官方测试组', kind: 'official', score: 100, type: 'min', cases },
      { key: 'hack-gate', name: 'Hack 得分门槛', kind: 'hack_gate', score: 0, type: 'min', cases: [] },
    ] }] }
  } else {
    const all = (current.subtasks || []).flatMap(subtask => subtask.groups.flatMap(group => group.cases))
    const unique = new Map<string, RevisionCaseSpec>()
    for (const item of all) unique.set(`${item.inputObjectId}\0${item.outputObjectId}`, item)
    const cases = [...unique.values()].sort((left, right) => {
      if (left.source === 'hack' && right.source !== 'hack') return -1
      if (left.source !== 'hack' && right.source === 'hack') return 1
      return left.inputName.localeCompare(right.inputName, undefined, { numeric: true })
    })
    if (cases.length === 0) throw new Error('OI 测试版本没有可转换的测试点')
    spec = { mode: 'acm', cases }
  }
  return publishTestSetRevision({
    problemId: params.problemId, expectedLatestRevisionId: params.expectedLatestRevisionId,
    source: 'mode_transition', createdBy: params.updatedBy,
    baseConfigText: problem.LatestTestSetRevision.judgeConfig, spec,
    transactionHook: async tx => {
      const config = await tx.problemHackConfig.findUnique({ where: { problemId: params.problemId } })
      if (config) await tx.problemHackConfig.update({ where: { problemId: params.problemId }, data: {
        enabled: false, mode: params.targetMode, revision: { increment: 1 }, updatedBy: params.updatedBy,
      } })
    },
  })
}

export async function inspectTestSetRevisionMigration() {
  const problems = await prisma.problem.findMany({
    where: { OR: [
      { judgeConfig: { not: null } },
      { TrainingProblem: { some: { judgeConfigSnapshot: { not: null } } } },
    ] },
    select: {
      id: true, problemId: true, title: true, judgeConfig: true, latestTestSetRevisionId: true,
      TrainingProblem: { select: { id: true, judgeConfigSnapshot: true, testSetRevisionId: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const valid: Array<{ problemId: string; problemNumber: string; title: string; migrated: boolean; distinctSnapshots: number }> = []
  const invalid: Array<{ problemId: string; problemNumber: string; title: string; issues: string[] }> = []
  for (const problem of problems) {
    const configs = [...new Set([problem.judgeConfig, ...problem.TrainingProblem.map(item => item.judgeConfigSnapshot)].filter((item): item is string => Boolean(item?.trim())))]
    const testdataNames = new Set<string>()
    const assetNames = new Set<string>()
    const issues: string[] = []
    if (!problem.judgeConfig?.trim()) issues.push('题库题缺少当前 Judge Config，无法确定最新正式 Revision')
    for (const text of configs) {
      try {
        const config = parseConfig(text)
        const mode = config.mode === 'oi' || (config.mode !== 'acm' && Array.isArray(config.subtasks) && config.subtasks.length > 0) ? 'oi' : 'acm'
        if (mode === 'acm' && (!Array.isArray(config.cases) || config.cases.length === 0)) issues.push('ACM Judge Config 没有测试点')
        if (mode === 'oi') {
          const subtasks = Array.isArray(config.subtasks) ? config.subtasks : []
          const normalizedIds = normalizeLegacySubtaskIds(subtasks)
          const ids = normalizedIds.ids
          if (!subtasks.length) issues.push('OI Judge Config 没有 Subtask')
          if (subtasks.reduce((sum: number, item: any) => sum + Number(item.score || 0), 0) !== 100) issues.push('OI Subtask 总分不为 100')
          for (const [index, subtask] of subtasks.entries()) {
            const id = ids[index]
            const dependencies = normalizedIds.dependencyIds(subtask.if)
            if (dependencies.some((dep: number) => dep === id)) issues.push(`Subtask ${id} 依赖无效`)
            if (Array.isArray(subtask.groups) && subtask.groups.length > 0) {
              const officialScore = subtask.groups.filter((group: any) => group.kind !== 'hack_gate').reduce((sum: number, group: any) => sum + Number(group.score || 0), 0)
              if (officialScore !== Number(subtask.score || 0)) issues.push(`Subtask ${id} Official Group 分值不闭合`)
            }
          }
        }
        const cases = Array.isArray(config.cases) ? config.cases : (config.subtasks || []).flatMap((subtask: any) => subtask.groups?.length
          ? subtask.groups.flatMap((group: any) => group.cases || []) : subtask.cases || [])
        for (const item of cases) {
          const normalized = normalizeLegacyCase(item)
          if (normalized.input.trim()) testdataNames.add(normalized.input.trim())
          else issues.push('测试点缺少输入文件名')
          if (normalized.output.trim()) testdataNames.add(normalized.output.trim())
          else issues.push('测试点缺少答案文件名')
        }
        for (const asset of configuredAssetNames(text)) assetNames.add(asset)
      } catch (error: any) { issues.push(`Judge Config 无法解析：${error.message}`) }
    }
    const existingFiles = new Set((await prisma.testdataFile.findMany({ where: { problemId: problem.id }, select: { filename: true } })).map(item => item.filename))
    for (const name of testdataNames) {
      try {
        if (!existingFiles.has(name) || !fs.existsSync(path.join(problemRoot(problem.id), safeLogicalName(name)))) issues.push(`测试数据文件缺失：${name}`)
      } catch (error: any) { issues.push(error.message) }
    }
    // Checker/interactor/manager sources use dedicated metadata and are not
    // ordinary TestdataFile rows. Revisions pin their readable bytes from the
    // problem directory while their own upload APIs manage metadata.
    for (const name of assetNames) {
      try {
        if (!fs.existsSync(path.join(problemRoot(problem.id), safeLogicalName(name)))) issues.push(`评测资产文件缺失：${name}`)
      } catch (error: any) { issues.push(error.message) }
    }
    if (issues.length > 0) invalid.push({ problemId: problem.id, problemNumber: problem.problemId, title: problem.title, issues: [...new Set(issues)] })
    else valid.push({ problemId: problem.id, problemNumber: problem.problemId, title: problem.title, migrated: Boolean(problem.latestTestSetRevisionId), distinctSnapshots: configs.length })
  }
  return { valid, invalid, validCount: valid.length, invalidCount: invalid.length }
}

export async function migrateProblemTestSetRevisions(problemId: string, createdBy: string) {
  const problem = await prisma.problem.findUnique({
    where: { id: problemId },
    include: { TrainingProblem: { orderBy: { createdAt: 'asc' } }, LatestTestSetRevision: true },
  })
  if (!problem?.judgeConfig) throw new Error('题目没有 Judge Config')
  const trainingConfigs = problem.TrainingProblem.map(item => item.judgeConfigSnapshot).filter((item): item is string => Boolean(item?.trim()))
  const orderedConfigs = [...new Set([...trainingConfigs, problem.judgeConfig])]
  const revisionsByHash = new Map<string, string>()
  // Prefer the newest revision for a repeated projection hash. Historical
  // imports can legitimately contain equivalent immutable revisions; choosing
  // the oldest one would make every migration run publish another duplicate.
  const existing = await prisma.problemTestSetRevision.findMany({
    where: { problemId },
    orderBy: { revisionNumber: 'desc' },
  })
  for (const revision of existing) if (!revisionsByHash.has(revision.judgeConfigHash)) revisionsByHash.set(revision.judgeConfigHash, revision.id)
  let latestId = problem.latestTestSetRevisionId
  for (const configText of orderedConfigs) {
    const digest = sha256(configText)
    if (!revisionsByHash.has(digest)) {
      const spec = await resolveConfigSpec(problemId, configText)
      const revision = await publishTestSetRevision({ problemId, expectedLatestRevisionId: latestId, source: 'initial', createdBy, baseConfigText: configText, spec })
      latestId = revision!.id
      revisionsByHash.set(digest, revision!.id)
      revisionsByHash.set(revision!.judgeConfigHash, revision!.id)
    }
  }
  const currentHash = sha256(problem.judgeConfig)
  let currentRevisionId = revisionsByHash.get(currentHash)!
  if (latestId !== currentRevisionId) {
    const spec = await resolveConfigSpec(problemId, problem.judgeConfig)
    const revision = await publishTestSetRevision({ problemId, expectedLatestRevisionId: latestId, source: 'initial', createdBy, baseConfigText: problem.judgeConfig, spec })
    latestId = revision!.id; currentRevisionId = revision!.id
    revisionsByHash.set(currentHash, revision!.id)
    revisionsByHash.set(revision!.judgeConfigHash, revision!.id)
  }
  let pinned = 0, submissions = 0
  for (const item of problem.TrainingProblem) {
    const configText = item.judgeConfigSnapshot || problem.judgeConfig
    const revisionId = revisionsByHash.get(sha256(configText)) || currentRevisionId
    const revision = await prisma.problemTestSetRevision.findUnique({ where: { id: revisionId } })
    if (!revision) continue
    await prisma.trainingProblem.update({ where: { id: item.id }, data: {
      testSetRevisionId: revision.id, judgeConfigSnapshot: revision.judgeConfig,
      testGraphRevisionSnapshot: revision.revisionNumber, dataVersion: '2',
    } })
    const changed = await prisma.submission.updateMany({ where: { trainingProblemId: item.id, testSetRevisionId: null }, data: {
      testSetRevisionId: revision.id, judgeConfigHash: revision.judgeConfigHash,
    } })
    pinned++; submissions += changed.count
  }
  return { latestRevisionId: latestId, revisionCount: revisionsByHash.size, pinnedTrainingProblems: pinned, pinnedSubmissions: submissions }
}
