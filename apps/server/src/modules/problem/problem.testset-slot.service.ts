import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { getTestdataBlobStore, problemBlobKey } from '../storage/blob-store'
import { validateOiFormalLimits } from './problem.oi-candidate-policy'

const TESTDATA_ROOT = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')

export type SlotCaseSpec = {
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

export type SlotGroupSpec = {
  key: string
  name: string
  kind: 'official' | 'hack_gate'
  score: number
  type: 'min' | 'max' | 'sum'
  cases: SlotCaseSpec[]
}

export type SlotSubtaskSpec = {
  id: number
  score: number
  if: number[]
  groups: SlotGroupSpec[]
}

export type TestSetSlotSpec = {
  mode: 'acm' | 'oi'
  cases?: SlotCaseSpec[]
  subtasks?: SlotSubtaskSpec[]
}

export class TestSetSlotConflict extends Error {
  code = 'TEST_SET_SLOT_STALE'
  constructor() {
    super('题目测试数据已更新，请刷新后重试')
  }
}

export class TestSetSlotValidationError extends Error {
  statusCode = 422
  code: string
  issues: ReturnType<typeof validateOiFormalLimits>
  constructor(issues: ReturnType<typeof validateOiFormalLimits>) {
    super(issues[0]?.message || '测试数据不符合约束')
    this.code = issues[0]?.code || 'INVALID_TEST_SET_SLOT'
    this.issues = issues
  }
}

export class TestSetCaseLimitError extends Error {
  statusCode = 422
  code = 'ACM_CASE_LIMIT_REACHED'
  constructor() { super('ACM 当前测试数据最多允许 100 个唯一测试点；满额后必须通过 Selector 替换') }
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
  } satisfies SlotCaseSpec
}

export async function resolveGraphDraft(problemId: string, input: any): Promise<TestSetSlotSpec> {
  const subtasks = Array.isArray(input?.subtasks) ? input.subtasks : []
  const testcaseIds = [...new Set<string>(subtasks.flatMap((subtask: any) => (subtask.groups || [])
    .flatMap((group: any) => (group.cases || []).map((item: any) => String(item.testcaseId || '')))).filter(Boolean))]
  const testcases = await prisma.problemTestcase.findMany({
    where: { problemId, id: { in: testcaseIds } },
    include: { InputFile: true, OutputFile: true },
  })
  if (testcases.length !== testcaseIds.length) throw new Error('存在不属于当前题目的 Testcase')
  const resolved = new Map<string, SlotCaseSpec>()
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

export async function resolveConfigSpec(problemId: string, configText: string): Promise<TestSetSlotSpec> {
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
  const subtasks: SlotSubtaskSpec[] = []
  for (const [index, raw] of rawSubtasks.entries()) {
    const id = normalizedIds.ids[index]
    const rawGroups = Array.isArray(raw.groups) && raw.groups.length > 0
      ? raw.groups
      : [
          { id: `official-${id}`, name: '官方测试组', kind: 'official', score: Number(raw.score || 0), type: raw.type || raw.scoring || 'min', cases: raw.cases || [] },
          { id: 'hack-gate', name: 'Hack 得分门槛', kind: 'hack_gate', score: 0, type: 'min', cases: [] },
        ]
    const groups: SlotGroupSpec[] = []
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

function projectRevisionConfig(baseConfigText: string | null, spec: TestSetSlotSpec) {
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

export async function expireTestSetReaders(now = new Date()) {
  const expired = await prisma.problemTestSetReader.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now } },
    orderBy: { expiresAt: 'asc' },
    take: 500,
    select: { id: true },
  })
  for (const item of expired) await releaseTestSetReader(item.id, 'EXPIRED')
  return { expired: expired.length }
}


type TestSetSlot = 'STABLE' | 'EVOLVING'
type SlotSource = 'initial' | 'admin_edit' | 'hack' | 'contribution' | 'promotion' | 'mode_transition' | 'migration'

type SlotManifest = {
  problemId: string
  slot: TestSetSlot
  source: SlotSource
  sourceId?: string | null
  requestedBy?: string | null
  spec: TestSetSlotSpec
  judgeConfig: string
  judgeConfigHash: string
  graphHash: string
  expectedFencingToken?: number | null
}

export class TestSetSlotBusyError extends Error {
  statusCode = 409
  code = 'TEST_SET_SLOT_WRITE_PENDING'
  constructor(public readonly slot: TestSetSlot) {
    super(slot === 'STABLE' ? 'Stable 数据正在排队更新，请稍后重试' : 'Evolving 数据正在排队更新，请稍后重试')
  }
}

export class TestSetSlotFenceConflict extends Error {
  statusCode = 409
  code = 'TEST_SET_SLOT_FENCE_CONFLICT'
  constructor() { super('测试数据已变化，当前操作必须重新验证') }
}

function slotDirectory(problemId: string, slot: TestSetSlot) {
  return path.join(problemRoot(problemId), 'slots', slot.toLowerCase())
}

function stagingRoot(problemId: string) {
  return path.join(problemRoot(problemId), '.slot-writers')
}

function promotionSnapshotDirectory(problemId: string, jobId: string) {
  return path.join(problemRoot(problemId), '.promotion-snapshots', jobId)
}

async function materializeSpec(problemId: string, destination: string, spec: TestSetSlotSpec, judgeConfig: string) {
  await fs.promises.rm(destination, { recursive: true, force: true })
  await fs.promises.mkdir(destination, { recursive: true })
  try {
    const allCases = spec.mode === 'acm' ? spec.cases || [] : (spec.subtasks || []).flatMap(subtask => subtask.groups.flatMap(group => group.cases))
    const objectIds = [...new Set(allCases.flatMap(item => [item.inputObjectId, item.outputObjectId]))]
    const objects = await prisma.testdataObject.findMany({ where: { problemId, id: { in: objectIds } } })
    if (objects.length !== objectIds.length) throw new Error('测试槽引用了不存在的测试数据对象')
    const byId = new Map(objects.map(item => [item.id, item]))
    const targets = new Map<string, string>()
    for (const item of allCases) {
      for (const [nameValue, objectId] of [[item.inputName, item.inputObjectId], [item.outputName, item.outputObjectId]] as const) {
        const name = safeLogicalName(nameValue)
        const object = byId.get(objectId)!
        const previous = targets.get(name)
        if (previous && previous !== object.sha256) throw new Error('测试槽内文件名冲突：' + name)
        targets.set(name, object.sha256)
        const target = path.join(destination, name)
        if (!fs.existsSync(target)) await getTestdataBlobStore().materialize(problemBlobKey(problemId, object.storageKey), target)
      }
    }
    for (const name of configuredAssetNames(judgeConfig)) {
      const source = path.join(problemRoot(problemId), name)
      const target = path.join(destination, name)
      await fs.promises.access(source, fs.constants.R_OK).catch(() => { throw new Error('评测资产文件缺失：' + name) })
      if (!fs.existsSync(target)) await fs.promises.copyFile(source, target)
    }
  } catch (error) {
    await fs.promises.rm(destination, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function writeManifest(stagingPath: string, manifest: SlotManifest) {
  await fs.promises.writeFile(path.join(stagingPath, '.slot-manifest.json'), JSON.stringify(manifest), 'utf8')
}

async function readManifest(stagingPath: string): Promise<SlotManifest> {
  return JSON.parse(await fs.promises.readFile(path.join(stagingPath, '.slot-manifest.json'), 'utf8')) as SlotManifest
}

function validateSpec(spec: TestSetSlotSpec) {
  if (spec.mode === 'acm') {
    const uniqueCases = new Set((spec.cases || []).map(item => item.testcaseId || item.inputObjectId + '\0' + item.outputObjectId))
    if (uniqueCases.size > 100) throw new TestSetCaseLimitError()
  }
  const issues = validateOiFormalLimits(spec)
  if (issues.length) throw new TestSetSlotValidationError(issues)
}

async function writeSlotRows(tx: Prisma.TransactionClient, manifest: SlotManifest, materializedPath: string) {
  const { problemId, slot, spec, judgeConfig, judgeConfigHash, graphHash, source } = manifest
  const current = await tx.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId, slot } } })
  const fencingToken = (current?.fencingToken || 0) + 1
  if (current) {
    const subtasks = await tx.problemTestSetSlotSubtask.findMany({ where: { problemId, slot }, select: { id: true } })
    const subtaskIds = subtasks.map(item => item.id)
    if (subtaskIds.length) {
      await tx.problemTestSetSlotDependency.deleteMany({ where: { OR: [{ subtaskId: { in: subtaskIds } }, { dependsOnId: { in: subtaskIds } }] } })
    }
    await tx.problemTestSetSlotGroupCase.deleteMany({ where: { problemId, slot } })
    await tx.problemTestSetSlotGroup.deleteMany({ where: { problemId, slot } })
    await tx.problemTestSetSlotSubtask.deleteMany({ where: { problemId, slot } })
    await tx.problemTestSetSlotCase.deleteMany({ where: { problemId, slot } })
  }
  await tx.problemTestSetSlot.upsert({
    where: { problemId_slot: { problemId, slot } },
    update: { mode: spec.mode, source, judgeConfig, judgeConfigHash, graphHash, materializedPath, fencingToken, activeReaderCount: 0 },
    create: { problemId, slot, mode: spec.mode, source, judgeConfig, judgeConfigHash, graphHash, materializedPath, fencingToken, writerGateClosed: true },
  })
  if (spec.mode === 'acm') {
    for (const [orderIndex, item] of (spec.cases || []).entries()) {
      await tx.problemTestSetSlotCase.create({ data: {
        id: crypto.randomUUID(), problemId, slot, testcaseId: item.testcaseId || null,
        inputObjectId: item.inputObjectId, outputObjectId: item.outputObjectId,
        inputName: item.inputName, outputName: item.outputName, orderIndex,
        score: item.score ?? null, time: item.time || null, memory: item.memory || null, source: item.source,
      } })
    }
  } else {
    const ids = new Map<number, string>()
    for (const [orderIndex, subtask] of (spec.subtasks || []).entries()) {
      const id=crypto.randomUUID(); ids.set(subtask.id,id)
      await tx.problemTestSetSlotSubtask.create({ data: { id, problemId, slot, subtaskId: subtask.id, score: subtask.score, orderIndex } })
      for (const [groupIndex, group] of subtask.groups.entries()) {
        const groupId=crypto.randomUUID()
        await tx.problemTestSetSlotGroup.create({ data: {
          id: groupId, problemId, slot, subtaskId: id, key: group.key, name: group.name,
          kind: group.kind, score: group.score, aggregation: group.type, orderIndex: groupIndex,
        } })
        for (const [caseIndex,item] of group.cases.entries()) {
          await tx.problemTestSetSlotGroupCase.create({ data: {
            id: crypto.randomUUID(), problemId, slot, groupId, testcaseId: item.testcaseId || null,
            inputObjectId: item.inputObjectId, outputObjectId: item.outputObjectId,
            inputName: item.inputName, outputName: item.outputName, orderIndex: caseIndex,
            score: item.score ?? null, time: item.time || null, memory: item.memory || null, source: item.source,
          } })
        }
      }
    }
    for (const subtask of spec.subtasks || []) for (const dependency of subtask.if) {
      const subtaskId=ids.get(subtask.id), dependsOnId=ids.get(dependency)
      if (!subtaskId || !dependsOnId) throw new Error('Subtask 依赖不存在')
      await tx.problemTestSetSlotDependency.create({ data: { id: crypto.randomUUID(), subtaskId, dependsOnId } })
    }
  }
  return fencingToken
}

async function adjustSlotReaderCount(tx: Prisma.TransactionClient, problemId: string, slot: TestSetSlot, delta: 1 | -1) {
  await tx.$executeRaw`
    UPDATE "ProblemTestSetSlot"
    SET "activeReaderCount" = GREATEST(0, "activeReaderCount" + ${delta})
    WHERE "problemId" = ${problemId}
      AND "slot" = CAST(${slot} AS "ProblemTestSetSlotKind")
  `
}

async function setSlotWriterGate(tx: Prisma.TransactionClient, problemId: string, slot: TestSetSlot, closed: boolean) {
  await tx.$executeRaw`
    UPDATE "ProblemTestSetSlot"
    SET "writerGateClosed" = ${closed}
    WHERE "problemId" = ${problemId}
      AND "slot" = CAST(${slot} AS "ProblemTestSetSlotKind")
  `
}
export async function acquireTestSetReaderTx(tx: Prisma.TransactionClient, params: {
  problemId: string
  slot: TestSetSlot
  ownerType: string
  ownerId: string
  expiresAt?: Date | null
}) {
  await acquireProblemMutationLock(tx, params.problemId)
  const slotRow = await tx.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId: params.problemId, slot: params.slot } } })
  if (!slotRow) throw new Error(params.slot + ' 测试数据尚未配置')
  if (slotRow.writerGateClosed) throw new TestSetSlotBusyError(params.slot)
  const existing = await tx.problemTestSetReader.findUnique({
    where: { problemId_slot_ownerType_ownerId: { problemId: params.problemId, slot: params.slot, ownerType: params.ownerType, ownerId: params.ownerId } },
  })
  const reader = await tx.problemTestSetReader.upsert({
    where: { problemId_slot_ownerType_ownerId: { problemId: params.problemId, slot: params.slot, ownerType: params.ownerType, ownerId: params.ownerId } },
    update: { status: 'ACTIVE', fencingToken: slotRow.fencingToken, renewedAt: new Date(), expiresAt: params.expiresAt || null, releasedAt: null },
    create: { problemId: params.problemId, slot: params.slot, ownerType: params.ownerType, ownerId: params.ownerId, fencingToken: slotRow.fencingToken, expiresAt: params.expiresAt || null },
  })
  if (existing?.status !== 'ACTIVE') {
    await adjustSlotReaderCount(tx, params.problemId, params.slot, 1)
  }
  return { reader, slot: slotRow }
}

export async function acquireTestSetReader(params: Parameters<typeof acquireTestSetReaderTx>[1]) {
  return prisma.$transaction(tx => acquireTestSetReaderTx(tx, params), { timeout: 15_000 })
}

export async function releaseTestSetReaderTx(tx: Prisma.TransactionClient, readerId: string, status: 'RELEASED' | 'EXPIRED' = 'RELEASED') {
  const reader = await tx.problemTestSetReader.findUnique({ where: { id: readerId } })
  if (!reader || reader.status !== 'ACTIVE') return reader
  await acquireProblemMutationLock(tx, reader.problemId)
  const changed = await tx.problemTestSetReader.updateMany({ where: { id: readerId, status: 'ACTIVE' }, data: { status, releasedAt: new Date() } })
  if (changed.count) {
    await adjustSlotReaderCount(tx, reader.problemId, reader.slot as TestSetSlot, -1)
  }
  return reader
}

export async function releaseTestSetReader(readerId: string, status: 'RELEASED' | 'EXPIRED' = 'RELEASED') {
  const released = await prisma.$transaction(tx => releaseTestSetReaderTx(tx, readerId, status), { timeout: 15_000 })
  if (released) await processTestSetWriters({ problemId: released.problemId, slot: released.slot as TestSetSlot })
  return released
}

async function queueSlotWriter(params: {
  problemId: string
  slot: TestSetSlot
  source: SlotSource
  sourceId?: string | null
  requestedBy?: string | null
  baseConfigText: string | null
  spec: TestSetSlotSpec
  expectedFencingToken?: number | null
}) {
  validateSpec(params.spec)
  const judgeConfig=projectRevisionConfig(params.baseConfigText,params.spec)
  const manifest: SlotManifest={
    problemId:params.problemId,slot:params.slot,source:params.source,sourceId:params.sourceId,
    requestedBy:params.requestedBy,spec:params.spec,judgeConfig,
    judgeConfigHash:sha256(judgeConfig),graphHash:stableHash(params.spec),
    expectedFencingToken:params.expectedFencingToken ?? null,
  }
  const requestHash=stableHash({slot:params.slot,source:params.source,sourceId:params.sourceId||null,graphHash:manifest.graphHash,judgeConfigHash:manifest.judgeConfigHash})
  const existing=await prisma.problemTestSetWriter.findUnique({where:{problemId_slot_requestHash:{problemId:params.problemId,slot:params.slot,requestHash}}})
  if (existing) return existing
  const writerId=crypto.randomUUID()
  const stagingPath=path.join(stagingRoot(params.problemId),writerId)
  await materializeSpec(params.problemId,stagingPath,params.spec,judgeConfig)
  await writeManifest(stagingPath,manifest)
  try {
    return await prisma.$transaction(async tx=>{
      await acquireProblemMutationLock(tx,params.problemId)
      const slotRow=await tx.problemTestSetSlot.findUnique({where:{problemId_slot:{problemId:params.problemId,slot:params.slot}}})
      if (params.expectedFencingToken != null && slotRow?.fencingToken !== params.expectedFencingToken) throw new TestSetSlotFenceConflict()
      if (slotRow) await setSlotWriterGate(tx, params.problemId, params.slot, true)
      return tx.problemTestSetWriter.create({data:{
        id:writerId,problemId:params.problemId,slot:params.slot,sourceType:params.source,sourceId:params.sourceId||null,
        requestedBy:params.requestedBy||null,requestHash,status:'QUEUED',stagingPath:path.relative(problemRoot(params.problemId),stagingPath),
      }})
    },{timeout:15_000})
  } catch(error) {
    await fs.promises.rm(stagingPath,{recursive:true,force:true}).catch(()=>{})
    if ((error as any)?.code === 'P2002') return prisma.problemTestSetWriter.findUniqueOrThrow({where:{problemId_slot_requestHash:{problemId:params.problemId,slot:params.slot,requestHash}}})
    throw error
  }
}

export async function recoverInterruptedTestSetWriters(now = new Date()) {
  const staleBefore = new Date(now.getTime() - 2 * 60_000)
  const writers = await prisma.problemTestSetWriter.findMany({
    where: { status: 'APPLYING', startedAt: { lte: staleBefore } },
    orderBy: { startedAt: 'asc' },
    take: 100,
  })
  let recovered = 0
  let failed = 0
  for (const writer of writers) {
    const root = problemRoot(writer.problemId)
    const staging = path.resolve(root, writer.stagingPath || '')
    const final = slotDirectory(writer.problemId, writer.slot as TestSetSlot)
    const backup = `${final}.backup-${writer.id}`
    try {
      if (!fs.existsSync(staging)) {
        if (!fs.existsSync(final)) throw new Error('中断写任务缺少 staging 和目标目录')
        const slotExists = Boolean(await prisma.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId: writer.problemId, slot: writer.slot } }, select: { problemId: true } }))
        if (slotExists && !fs.existsSync(backup)) throw new Error('中断写任务缺少原槽位备份，拒绝猜测恢复')
        await fs.promises.mkdir(path.dirname(staging), { recursive: true })
        await fs.promises.rename(final, staging)
        if (fs.existsSync(backup)) await fs.promises.rename(backup, final)
      }
      const changed = await prisma.problemTestSetWriter.updateMany({
        where: { id: writer.id, status: 'APPLYING', startedAt: writer.startedAt },
        data: { status: 'QUEUED', startedAt: null, errorCode: 'INTERRUPTED_WRITER_RECOVERED', errorMessage: null },
      })
      recovered += changed.count
    } catch (error) {
      const changed = await prisma.$transaction(async tx => {
        await acquireProblemMutationLock(tx, writer.problemId)
        const result = await tx.problemTestSetWriter.updateMany({
          where: { id: writer.id, status: 'APPLYING' },
          data: { status: 'FAILED', finishedAt: new Date(), errorCode: 'INTERRUPTED_WRITER_RECOVERY_FAILED', errorMessage: String((error as Error).message).slice(0, 4000) },
        })
        const pending = await tx.problemTestSetWriter.count({ where: { problemId: writer.problemId, slot: writer.slot, status: { in: ['QUEUED', 'DRAINING', 'APPLYING'] } } })
        const slotRow = await tx.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId: writer.problemId, slot: writer.slot } } })
        if (slotRow) await setSlotWriterGate(tx, writer.problemId, writer.slot as TestSetSlot, pending > 0)
        return result
      })
      failed += changed.count
    }
  }
  return { scanned: writers.length, recovered, failed }
}

export async function processTestSetWriters(filter?: {problemId?: string; slot?: TestSetSlot}) {
  const queued=await prisma.problemTestSetWriter.findMany({
    where:{...(filter?.problemId?{problemId:filter.problemId}:{}),...(filter?.slot?{slot:filter.slot}:{}),status:{in:['QUEUED','DRAINING']}},
    orderBy:{requestedAt:'asc'},take:20,
  })
  for (const candidate of queued) {
    const queuedStaging=path.resolve(problemRoot(candidate.problemId),candidate.stagingPath||'')
    let queuedManifest: SlotManifest
    try {
      queuedManifest = await readManifest(queuedStaging)
    } catch (error) {
      await prisma.$transaction(async tx => {
        await acquireProblemMutationLock(tx, candidate.problemId)
        const current = await tx.problemTestSetWriter.findUnique({ where: { id: candidate.id } })
        if (!current || !['QUEUED', 'DRAINING'].includes(current.status)) return
        await tx.problemTestSetWriter.update({
          where: { id: candidate.id },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            errorCode: 'SLOT_STAGING_INVALID',
            errorMessage: String((error as any)?.message || error),
          },
        })
        const pending = await tx.problemTestSetWriter.count({
          where: { problemId: candidate.problemId, slot: candidate.slot, status: { in: ['QUEUED', 'DRAINING'] } },
        })
        const slotRow = await tx.problemTestSetSlot.findUnique({
          where: { problemId_slot: { problemId: candidate.problemId, slot: candidate.slot } },
        })
        if (slotRow) await setSlotWriterGate(tx, candidate.problemId, candidate.slot as TestSetSlot, pending > 0)
      }).catch(() => {})
      await fs.promises.rm(queuedStaging, { recursive: true, force: true }).catch(() => {})
      continue
    }
    const ready=await prisma.$transaction(async tx=>{
      await acquireProblemMutationLock(tx,candidate.problemId)
      const first=await tx.problemTestSetWriter.findFirst({where:{problemId:candidate.problemId,slot:candidate.slot,status:{in:['QUEUED','DRAINING']}},orderBy:{requestedAt:'asc'}})
      if (!first || first.id!==candidate.id) return null
      const slotRow=await tx.problemTestSetSlot.findUnique({where:{problemId_slot:{problemId:candidate.problemId,slot:candidate.slot}}})
      if (queuedManifest.expectedFencingToken != null && slotRow?.fencingToken !== queuedManifest.expectedFencingToken) {
        await tx.problemTestSetWriter.update({where:{id:candidate.id},data:{status:'FAILED',finishedAt:new Date(),errorCode:'TEST_SET_SLOT_FENCE_CONFLICT',errorMessage:'测试数据已变化，排队写入必须重新验证'}})
        const pending=await tx.problemTestSetWriter.count({where:{problemId:candidate.problemId,slot:candidate.slot,status:{in:['QUEUED','DRAINING']}}})
        if (slotRow) await setSlotWriterGate(tx,candidate.problemId,candidate.slot as TestSetSlot,pending>0)
        return null
      }
      if (slotRow && !slotRow.writerGateClosed) await setSlotWriterGate(tx, candidate.problemId, candidate.slot as TestSetSlot, true)
      if ((slotRow?.activeReaderCount||0)>0) {
        await tx.problemTestSetWriter.update({where:{id:candidate.id},data:{status:'DRAINING',startedAt:candidate.startedAt||new Date()}})
        return null
      }
      return tx.problemTestSetWriter.update({where:{id:candidate.id},data:{status:'APPLYING',startedAt:candidate.startedAt||new Date()}})
    },{timeout:15_000})
    if (!ready) {
      const terminal=await prisma.problemTestSetWriter.findUnique({where:{id:candidate.id},select:{status:true}})
      if (terminal?.status==='FAILED'||terminal?.status==='CANCELLED') await fs.promises.rm(queuedStaging,{recursive:true,force:true}).catch(()=>{})
      continue
    }
    const staging=path.resolve(problemRoot(ready.problemId),ready.stagingPath||'')
    const final=slotDirectory(ready.problemId,ready.slot as TestSetSlot)
    const backup=final+'.backup-'+ready.id
    try {
      const manifest=await readManifest(staging)
      await fs.promises.mkdir(path.dirname(final),{recursive:true})
      await fs.promises.rm(backup,{recursive:true,force:true})
      if (fs.existsSync(final)) await fs.promises.rename(final,backup)
      await fs.promises.rename(staging,final)
      try {
        await prisma.$transaction(async tx=>{
          await acquireProblemMutationLock(tx,ready.problemId)
          const latest=await tx.problemTestSetWriter.findUnique({where:{id:ready.id}})
          if (latest?.status!=='APPLYING') throw new Error('写任务状态已变化')
          await writeSlotRows(tx,manifest,path.relative(problemRoot(ready.problemId),final))
          await tx.problem.update({
            where: { id: ready.problemId },
            data: {
              ...(ready.slot === 'STABLE' ? { judgeConfig: manifest.judgeConfig } : {}),
              testGraphRevision: { increment: 1 },
            },
          })
          await tx.problemTestSetWriter.update({where:{id:ready.id},data:{status:'SUCCEEDED',finishedAt:new Date(),stagingPath:null}})
          const pending=await tx.problemTestSetWriter.count({where:{problemId:ready.problemId,slot:ready.slot,status:{in:['QUEUED','DRAINING']}}})
          await setSlotWriterGate(tx, ready.problemId, ready.slot as TestSetSlot, pending > 0)
        },{timeout:30_000})
      } catch(error) {
        await fs.promises.rm(final,{recursive:true,force:true}).catch(()=>{})
        if (fs.existsSync(backup)) await fs.promises.rename(backup,final)
        throw error
      }
      await fs.promises.rm(backup,{recursive:true,force:true}).catch(()=>{})
    } catch(error) {
      await prisma.$transaction(async tx=>{
        await acquireProblemMutationLock(tx,ready.problemId)
        await tx.problemTestSetWriter.update({where:{id:ready.id},data:{status:'FAILED',finishedAt:new Date(),errorCode:(error as any)?.code||'SLOT_WRITE_FAILED',errorMessage:String((error as any)?.message||error)}})
        const pending=await tx.problemTestSetWriter.count({where:{problemId:ready.problemId,slot:ready.slot,status:{in:['QUEUED','DRAINING']}}})
        const slotRow=await tx.problemTestSetSlot.findUnique({where:{problemId_slot:{problemId:ready.problemId,slot:ready.slot}}})
        if (slotRow) await setSlotWriterGate(tx, ready.problemId, ready.slot as TestSetSlot, pending > 0)
      }).catch(()=>{})
    }
  }
}

export async function replaceTestSetSlot(params: {
  problemId: string
  slot: TestSetSlot
  source: SlotSource
  sourceId?: string | null
  requestedBy?: string | null
  baseConfigText: string | null
  spec: TestSetSlotSpec
  expectedFencingToken?: number | null
}) {
  const writer=await queueSlotWriter(params)
  await processTestSetWriters({problemId:params.problemId,slot:params.slot})
  return prisma.problemTestSetWriter.findUniqueOrThrow({where:{id:writer.id}})
}

export async function loadTestSetSlotSpec(problemId:string,slot:TestSetSlot):Promise<TestSetSlotSpec|null>{
  const row=await prisma.problemTestSetSlot.findUnique({
    where:{problemId_slot:{problemId,slot}},
    include:{Cases:{orderBy:{orderIndex:'asc'}},Subtasks:{orderBy:{orderIndex:'asc'},include:{
      Dependencies:{include:{DependsOn:true}},
      Groups:{orderBy:{orderIndex:'asc'},include:{Cases:{orderBy:{orderIndex:'asc'}}}},
    }}},
  })
  if(!row)return null
  if(row.mode==='acm')return{mode:'acm',cases:row.Cases.map(item=>({
    testcaseId:item.testcaseId,inputName:item.inputName,outputName:item.outputName,inputObjectId:item.inputObjectId,outputObjectId:item.outputObjectId,
    source:item.source,score:item.score,time:item.time,memory:item.memory,
  }))}
  return{mode:'oi',subtasks:row.Subtasks.map(subtask=>({
    id:subtask.subtaskId,score:subtask.score,if:subtask.Dependencies.map(item=>item.DependsOn.subtaskId).sort((a,b)=>a-b),
    groups:subtask.Groups.map(group=>({key:group.key,name:group.name,kind:group.kind as 'official'|'hack_gate',score:group.score,
      type:group.aggregation as 'min'|'max'|'sum',cases:group.Cases.map(item=>({
        testcaseId:item.testcaseId,inputName:item.inputName,outputName:item.outputName,inputObjectId:item.inputObjectId,outputObjectId:item.outputObjectId,
        source:item.source,score:item.score,time:item.time,memory:item.memory,
      }))})),
  }))}
}

export async function ensureInitialTestSetSlots(problemId:string,createdBy?:string|null){
  const problem=await prisma.problem.findUnique({where:{id:problemId},select:{judgeConfig:true,dataContributionEnabled:true,TestSetSlots:{select:{slot:true}}}})
  if(!problem)throw new Error('题目不存在')
  if(!problem.judgeConfig?.trim())throw new Error('题目尚未配置本地评测')
  const existing=new Set(problem.TestSetSlots.map(item=>item.slot))
  if(!existing.has('STABLE')){
    const spec=await resolveConfigSpec(problemId,problem.judgeConfig)
    await replaceTestSetSlot({problemId,slot:'STABLE',source:'initial',requestedBy:createdBy,baseConfigText:problem.judgeConfig,spec})
  }
  if(problem.dataContributionEnabled&&!existing.has('EVOLVING')){
    const spec=await loadTestSetSlotSpec(problemId,'STABLE')
    const stable=await prisma.problemTestSetSlot.findUnique({where:{problemId_slot:{problemId,slot:'STABLE'}}})
    if(spec&&stable)await replaceTestSetSlot({problemId,slot:'EVOLVING',source:'initial',requestedBy:createdBy,baseConfigText:stable.judgeConfig,spec})
  }
  return prisma.problemTestSetSlot.findMany({where:{problemId},orderBy:{slot:'asc'}})
}

export async function resolveSubmissionTestSet(params:{
  problemId:string
  ownerType:string
  ownerId:string
  useEvolving?:boolean
  slot?:TestSetSlot
  transaction?:Prisma.TransactionClient
  expiresAt?:Date|null
}){
  const execute=async(tx:Prisma.TransactionClient)=>{
    let slot:TestSetSlot=params.slot||(params.useEvolving?'EVOLVING':'STABLE')
    if(slot==='EVOLVING'){
      const exists=await tx.problemTestSetSlot.findUnique({where:{problemId_slot:{problemId:params.problemId,slot}}})
      if(!exists)slot='STABLE'
    }
    return acquireTestSetReaderTx(tx,{problemId:params.problemId,slot,ownerType:params.ownerType,ownerId:params.ownerId,expiresAt:params.expiresAt})
  }
  return params.transaction?execute(params.transaction):prisma.$transaction(execute,{timeout:15_000})
}

export async function getTestSetSlotState(problemId:string){
  return prisma.problemTestSetSlot.findMany({where:{problemId},select:{
    problemId:true,slot:true,mode:true,source:true,graphHash:true,judgeConfigHash:true,fencingToken:true,writerGateClosed:true,activeReaderCount:true,updatedAt:true,
  },orderBy:{slot:'asc'}})
}

export async function loadTestSetGraph(problemId:string,slot:TestSetSlot='STABLE'){
  const row=await prisma.problemTestSetSlot.findUnique({where:{problemId_slot:{problemId,slot}},include:{
    Subtasks:{orderBy:{orderIndex:'asc'},include:{Dependencies:{include:{DependsOn:true}},Groups:{orderBy:{orderIndex:'asc'},include:{Cases:{orderBy:{orderIndex:'asc'}}}}}},
  }})
  if(!row||row.mode!=='oi')return null
  return{slot:row.slot,source:row.source,graphHash:row.graphHash,fencingToken:row.fencingToken,updatedAt:row.updatedAt,subtasks:row.Subtasks.map(subtask=>({
    dbId:subtask.id,id:subtask.subtaskId,score:subtask.score,if:subtask.Dependencies.map(dep=>dep.DependsOn.subtaskId).sort((a,b)=>a-b),
    groups:subtask.Groups.map(group=>({id:group.id,key:group.key,name:group.name,kind:group.kind,score:group.score,type:group.aggregation,
      cases:group.Cases.map(link=>({testcaseId:link.testcaseId,input:link.inputName,output:link.outputName,source:link.source,score:link.score,time:link.time,memory:link.memory}))})),
  }))}
}

export function testSetSlotAbsolutePath(problemId:string,slot:{materializedPath:string}){
  const root=problemRoot(problemId),target=path.resolve(root,slot.materializedPath)
  if(target!==root&&!target.startsWith(root+path.sep))throw new Error('Invalid test-set slot path')
  return target
}

export async function materializeCurrentTestSetSlots(problemId?: string) {
  const [activeReaders, activeWriters] = await Promise.all([
    prisma.problemTestSetReader.count({ where: { ...(problemId ? { problemId } : {}), status: 'ACTIVE' } }),
    prisma.problemTestSetWriter.count({
      where: { ...(problemId ? { problemId } : {}), status: { in: ['QUEUED', 'DRAINING', 'APPLYING'] } },
    }),
  ])
  if (activeReaders || activeWriters) {
    throw new Error('测试槽正在使用或更新，拒绝离线物化')
  }
  const slots = await prisma.problemTestSetSlot.findMany({
    where: problemId ? { problemId } : undefined,
    orderBy: [{ problemId: 'asc' }, { slot: 'asc' }],
  })
  let materialized = 0
  let skipped = 0
  for (const slot of slots) {
    const target = testSetSlotAbsolutePath(slot.problemId, slot)
    const manifestPath = path.join(target, '.slot-manifest.json')
    try {
      const current = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')) as Partial<SlotManifest>
      if (current.graphHash === slot.graphHash && current.judgeConfigHash === slot.judgeConfigHash && current.slot === slot.slot) {
        skipped++
        continue
      }
    } catch {
      // Missing or stale filesystem materialization is rebuilt below.
    }
    const spec = await loadTestSetSlotSpec(slot.problemId, slot.slot)
    if (!spec) throw new Error(`测试槽不存在：${slot.problemId}/${slot.slot}`)
    const staging = path.join(problemRoot(slot.problemId), '.slot-materialize', `${slot.slot.toLowerCase()}-${crypto.randomUUID()}`)
    const backup = `${target}.materialize-backup-${crypto.randomUUID()}`
    const manifest: SlotManifest = {
      problemId: slot.problemId, slot: slot.slot, source: slot.source as SlotSource, spec,
      judgeConfig: slot.judgeConfig, judgeConfigHash: slot.judgeConfigHash, graphHash: slot.graphHash,
    }
    await materializeSpec(slot.problemId, staging, spec, slot.judgeConfig)
    await writeManifest(staging, manifest)
    try {
      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      await fs.promises.rm(backup, { recursive: true, force: true })
      if (fs.existsSync(target)) await fs.promises.rename(target, backup)
      await fs.promises.rename(staging, target)
      await fs.promises.rm(backup, { recursive: true, force: true })
      materialized++
    } catch (error) {
      await fs.promises.rm(target, { recursive: true, force: true }).catch(() => {})
      if (fs.existsSync(backup)) await fs.promises.rename(backup, target)
      await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  }
  return { slots: slots.length, materialized, skipped }
}

export async function listTestSetPromotionJobs(problemId:string){
  return prisma.problemTestSetPromotionJob.findMany({
    where:{problemId},orderBy:{createdAt:'desc'},take:100,select:{
      id:true,problemId:true,status:true,evolvingGraphHash:true,evolvingFencingToken:true,
      validatorPassed:true,standardPassed:true,acceptedReplayPassed:true,failureReason:true,createdAt:true,startedAt:true,finishedAt:true,
    },
  })
}

export async function captureEvolvingForPromotion(params:{problemId:string;requestedBy?:string|null}){
  const jobId=crypto.randomUUID()
  const acquired=await acquireTestSetReader({problemId:params.problemId,slot:'EVOLVING',ownerType:'PROMOTION_CAPTURE',ownerId:jobId})
  const snapshot=promotionSnapshotDirectory(params.problemId,jobId)
  try{
    const spec=await loadTestSetSlotSpec(params.problemId,'EVOLVING')
    if(!spec)throw new Error('Evolving 数据不存在')
    await fs.promises.mkdir(path.dirname(snapshot),{recursive:true})
    await fs.promises.cp(testSetSlotAbsolutePath(params.problemId,acquired.slot),snapshot,{recursive:true,force:true})
    await fs.promises.writeFile(path.join(snapshot,'.promotion-manifest.json'),JSON.stringify({
      problemId:params.problemId,graphHash:acquired.slot.graphHash,fencingToken:acquired.slot.fencingToken,judgeConfig:acquired.slot.judgeConfig,spec,
    }),'utf8')
    await prisma.problemTestSetPromotionJob.create({data:{id:jobId,problemId:params.problemId,status:'captured',evolvingGraphHash:acquired.slot.graphHash,evolvingFencingToken:acquired.slot.fencingToken,requestedBy:params.requestedBy||null}})
    return{jobId,snapshotPath:snapshot,graphHash:acquired.slot.graphHash,fencingToken:acquired.slot.fencingToken}
  }catch(error){
    await fs.promises.rm(snapshot,{recursive:true,force:true}).catch(()=>{})
    throw error
  }finally{
    await releaseTestSetReader(acquired.reader.id)
  }
}

export async function promoteCapturedEvolving(params:{
  jobId:string
  validationReport:Prisma.InputJsonValue
  validatorPassed:boolean
  standardPassed:boolean
  acceptedReplayPassed:boolean
  knownWrongReplaySummary?:Prisma.InputJsonValue
  requestedBy?:string|null
}){
  const job=await prisma.problemTestSetPromotionJob.findUnique({where:{id:params.jobId}})
  if(!job)throw new Error('Promotion 任务不存在')
  if(job.status==='succeeded'){
    const writer=await prisma.problemTestSetWriter.findFirst({where:{problemId:job.problemId,slot:'STABLE',sourceType:'promotion',sourceId:job.id},orderBy:{requestedAt:'desc'}})
    if(!writer)throw new Error('Promotion 已完成但缺少写入记录')
    return writer
  }
  if(!['captured','validation_failed'].includes(job.status))throw new Error('Promotion 任务当前不可验证')
  if(!params.validatorPassed||!params.standardPassed||!params.acceptedReplayPassed){
    await prisma.problemTestSetPromotionJob.update({where:{id:job.id},data:{
      status:'validation_failed',validationReport:params.validationReport,
      validatorPassed:params.validatorPassed,standardPassed:params.standardPassed,acceptedReplayPassed:params.acceptedReplayPassed,
      knownWrongReplaySummary:params.knownWrongReplaySummary,failureReason:'Promotion 必需验证未全部通过',startedAt:job.startedAt||new Date(),finishedAt:new Date(),
    }})
    throw new Error('Promotion 必需验证未全部通过')
  }
  const snapshot=promotionSnapshotDirectory(job.problemId,job.id)
  const captured=JSON.parse(await fs.promises.readFile(path.join(snapshot,'.promotion-manifest.json'),'utf8')) as {graphHash:string;fencingToken:number;judgeConfig:string;spec:TestSetSlotSpec}
  if(captured.graphHash!==job.evolvingGraphHash||captured.fencingToken!==job.evolvingFencingToken)throw new Error('Promotion 临时快照校验失败')
  await prisma.problemTestSetPromotionJob.update({where:{id:job.id},data:{
    status:'validated',validationReport:params.validationReport,validatorPassed:true,standardPassed:true,acceptedReplayPassed:true,
    knownWrongReplaySummary:params.knownWrongReplaySummary,startedAt:job.startedAt||new Date(),finishedAt:null,failureReason:null,
  }})
  const writer=await replaceTestSetSlot({problemId:job.problemId,slot:'STABLE',source:'promotion',sourceId:job.id,requestedBy:params.requestedBy||job.requestedBy,baseConfigText:captured.judgeConfig,spec:captured.spec})
  await prisma.problemTestSetPromotionJob.update({where:{id:job.id},data:{status:writer.status==='SUCCEEDED'?'succeeded':'waiting_stable_barrier',finishedAt:writer.status==='SUCCEEDED'?new Date():null}})
  if(writer.status==='SUCCEEDED')await fs.promises.rm(snapshot,{recursive:true,force:true}).catch(()=>{})
  return writer
}

export async function promoteCapturedEvolvingFromQuality(params:{jobId:string;qualitySnapshotId:string;requestedBy:string}){
  const job=await prisma.problemTestSetPromotionJob.findUnique({where:{id:params.jobId}})
  if(!job)throw new Error('Promotion 任务不存在')
  const snapshot=await prisma.testSetQualitySnapshot.findFirst({where:{
    id:params.qualitySnapshotId,problemId:job.problemId,slot:'EVOLVING',graphHash:job.evolvingGraphHash,qualityStatus:'READY',
  }})
  if(!snapshot)throw new Error('没有与该 Evolving 快照匹配的 READY 质量验证')
  const evidence=(snapshot.evidence&&typeof snapshot.evidence==='object'&&!Array.isArray(snapshot.evidence)?snapshot.evidence:{}) as Record<string,any>
  const gates=(evidence.gates&&typeof evidence.gates==='object'?evidence.gates:{}) as Record<string,any>
  const validatorPassed=gates.validatorReady===true
  const standardPassed=gates.standardReady===true&&gates.checkerReady===true
  const acceptedReplayPassed=gates.acceptedReplayPassed===true
  return promoteCapturedEvolving({
    jobId:job.id,requestedBy:params.requestedBy,validatorPassed,standardPassed,acceptedReplayPassed,
    validationReport:{qualitySnapshotId:snapshot.id,qualityStatus:snapshot.qualityStatus,overallScore:snapshot.overallScore,gates} as Prisma.InputJsonValue,
    knownWrongReplaySummary:{evaluationCoverage:snapshot.evaluationCoverage,holdoutCoverage:snapshot.holdoutCoverage} as Prisma.InputJsonValue,
  })
}

export async function reconcilePromotionWriters() {
  const jobs=await prisma.problemTestSetPromotionJob.findMany({where:{status:'waiting_stable_barrier'},orderBy:{createdAt:'asc'},take:100})
  let succeeded=0,failed=0
  for(const job of jobs){
    const writer=await prisma.problemTestSetWriter.findFirst({where:{problemId:job.problemId,slot:'STABLE',sourceType:'promotion',sourceId:job.id},orderBy:{requestedAt:'desc'}})
    if(writer?.status==='SUCCEEDED'){
      await prisma.problemTestSetPromotionJob.updateMany({where:{id:job.id,status:'waiting_stable_barrier'},data:{status:'succeeded',finishedAt:new Date(),failureReason:null}})
      await fs.promises.rm(promotionSnapshotDirectory(job.problemId,job.id),{recursive:true,force:true}).catch(()=>{})
      succeeded++
    }else if(writer?.status==='FAILED'||writer?.status==='CANCELLED'){
      await prisma.problemTestSetPromotionJob.updateMany({where:{id:job.id,status:'waiting_stable_barrier'},data:{status:'failed',finishedAt:new Date(),failureReason:writer.errorMessage||writer.errorCode||'Stable 写入失败'}})
      await fs.promises.rm(promotionSnapshotDirectory(job.problemId,job.id),{recursive:true,force:true}).catch(()=>{})
      failed++
    }
  }
  return{scanned:jobs.length,succeeded,failed}
}

export async function transitionJudgeMode(params:{problemId:string;targetMode:'acm'|'oi';slot?:TestSetSlot;expectedFencingToken:number;updatedBy:string}){
  const slot=params.slot||'STABLE'
  const currentRow=await prisma.problemTestSetSlot.findUnique({where:{problemId_slot:{problemId:params.problemId,slot}}})
  if(!currentRow)throw new Error('题目尚无测试数据')
  if(currentRow.fencingToken!==params.expectedFencingToken)throw new TestSetSlotFenceConflict()
  if(currentRow.mode===params.targetMode)return currentRow
  const current=await loadTestSetSlotSpec(params.problemId,slot)
  if(!current)throw new Error('当前测试数据不存在')
  let spec:TestSetSlotSpec
  if(params.targetMode==='oi'){
    const cases=current.mode==='acm'?current.cases||[]:[]
    if(!cases.length)throw new Error('ACM 数据没有可转换的测试点')
    spec={mode:'oi',subtasks:[{id:1,score:100,if:[],groups:[
      {key:'official-1',name:'官方测试组',kind:'official',score:100,type:'min',cases},
      {key:'hack-gate',name:'Hack 得分门槛',kind:'hack_gate',score:0,type:'min',cases:[]},
    ]}]}
  }else{
    const unique=new Map<string,SlotCaseSpec>()
    for(const item of (current.subtasks||[]).flatMap(subtask=>subtask.groups.flatMap(group=>group.cases)))unique.set(item.inputObjectId+'\0'+item.outputObjectId,item)
    const cases=[...unique.values()]
    if(!cases.length)throw new Error('OI 数据没有可转换的测试点')
    spec={mode:'acm',cases}
  }
  return replaceTestSetSlot({problemId:params.problemId,slot,source:'mode_transition',requestedBy:params.updatedBy,baseConfigText:currentRow.judgeConfig,spec,expectedFencingToken:params.expectedFencingToken})
}
