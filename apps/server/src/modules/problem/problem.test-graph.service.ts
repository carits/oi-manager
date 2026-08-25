import crypto from 'crypto'
import yaml from 'js-yaml'
import { prisma } from '../../prisma'

export type TestGraphIssue = { problemId: string; problemNumber: string; title: string; issues: string[] }

function parseConfig(text: string | null): Record<string, any> {
  if (!text?.trim()) return {}
  const value = yaml.load(text)
  return value && typeof value === 'object' ? value as Record<string, any> : {}
}

export function isOiConfig(config: Record<string, any>): boolean {
  return config.mode === 'oi' || (config.mode !== 'acm' && Array.isArray(config.subtasks) && config.subtasks.length > 0)
}

function legacySubtaskId(raw: any, index: number, count: number): number {
  if (Number.isInteger(Number(raw?.id)) && Number(raw.id) > 0) return Number(raw.id)
  // Historical single-subtask imports used the symbolic id `all`. Its meaning is
  // unambiguous, so normalize it deterministically instead of blocking migration.
  if (count === 1 && String(raw?.id || '').toLowerCase() === 'all') return 1
  return Number.NaN
}

function normalizeCase(item: any) {
  if (typeof item === 'number') return { input: `${item}.in`, output: `${item}.ans` }
  return {
    input: String(item?.input || ''),
    output: String(item?.output || ''),
    score: item?.score === undefined ? null : Number(item.score),
    time: item?.time ? String(item.time) : null,
    memory: item?.memory ? String(item.memory) : null,
  }
}

export async function inspectLegacyTestGraph(problemId: string) {
  const problem = await prisma.problem.findUnique({
    where: { id: problemId },
    include: { TestdataFile: true, ProblemSubtask: { select: { id: true } } },
  })
  if (!problem) return { ok: false, issues: ['题目不存在'], problem: null, config: null }
  const config = parseConfig(problem.judgeConfig)
  const issues: string[] = []
  if (!isOiConfig(config)) issues.push('不是 OI 评测配置')
  if (!Array.isArray(config.subtasks) || config.subtasks.length === 0) issues.push('缺少 subtasks')
  if (problem.ProblemSubtask.length > 0) return { ok: true, issues: [], problem, config, alreadyMigrated: true }

  const files = new Set(problem.TestdataFile.map(file => file.filename))
  const ids = new Set<number>()
  let totalScore = 0
  for (const [index, raw] of (config.subtasks || []).entries()) {
    const id = legacySubtaskId(raw, index, config.subtasks.length)
    if (!Number.isInteger(id) || id <= 0) issues.push(`Subtask #${index + 1} ID 无效`)
    if (ids.has(id)) issues.push(`Subtask ID ${id} 重复`)
    ids.add(id)
    const score = Number(raw.score || 0)
    if (!Number.isInteger(score) || score < 0) issues.push(`Subtask ${id} 分值无效`)
    totalScore += score
    if (!Array.isArray(raw.cases) || raw.cases.length === 0) issues.push(`Subtask ${id} 没有测试点`)
    for (const item of raw.cases || []) {
      const testCase = normalizeCase(item)
      if (!testCase.input || !testCase.output) issues.push(`Subtask ${id} 存在无效测试点`)
      if (testCase.input && !files.has(testCase.input)) issues.push(`缺少输入文件 ${testCase.input}`)
      if (testCase.output && !files.has(testCase.output)) issues.push(`缺少答案文件 ${testCase.output}`)
    }
  }
  if (totalScore !== 100) issues.push(`Subtask 总分为 ${totalScore}，必须为 100`)
  for (const [index, raw] of (config.subtasks || []).entries()) {
    const id = legacySubtaskId(raw, index, config.subtasks.length)
    for (const dep of raw.if || []) if (!ids.has(Number(dep))) issues.push(`Subtask ${id} 依赖不存在的 Subtask ${dep}`)
  }
  return { ok: issues.length === 0, issues: [...new Set(issues)], problem, config, alreadyMigrated: false }
}

export async function migrateLegacyTestGraph(problemId: string) {
  const inspected = await inspectLegacyTestGraph(problemId)
  if (!inspected.ok || !inspected.problem || !inspected.config) return inspected
  if (inspected.alreadyMigrated) return inspected
  const problem = inspected.problem
  const config = inspected.config
  const files = new Map(problem.TestdataFile.map(file => [file.filename, file]))

  await prisma.$transaction(async tx => {
    const subtaskDbIds = new Map<number, string>()
    const testcaseIds = new Map<string, string>()
    for (const [subtaskIndex, raw] of config.subtasks.entries()) {
      const subtaskId = legacySubtaskId(raw, subtaskIndex, config.subtasks.length)
      const dbId = crypto.randomUUID()
      subtaskDbIds.set(subtaskId, dbId)
      await tx.problemSubtask.create({
        data: { id: dbId, problemId, subtaskId, score: Number(raw.score || 0), orderIndex: subtaskIndex },
      })
      const officialGroupId = crypto.randomUUID()
      await tx.problemTestGroup.create({
        data: {
          id: officialGroupId,
          problemId,
          subtaskId: dbId,
          key: 'official-legacy',
          name: '官方测试组',
          kind: 'official',
          score: Number(raw.score || 0),
          aggregation: String(raw.type || raw.scoring || 'min'),
          orderIndex: 0,
        },
      })
      await tx.problemTestGroup.create({
        data: {
          id: crypto.randomUUID(),
          problemId,
          subtaskId: dbId,
          key: 'hack-gate',
          name: 'Hack 得分门槛',
          kind: 'hack_gate',
          score: 0,
          aggregation: 'min',
          orderIndex: 1,
        },
      })
      for (const [caseIndex, rawCase] of (raw.cases || []).entries()) {
        const testCase = normalizeCase(rawCase)
        const inputFile = files.get(testCase.input)!
        const outputFile = files.get(testCase.output)!
        const key = `${inputFile.id}\0${outputFile.id}`
        let testcaseId = testcaseIds.get(key)
        if (!testcaseId) {
          testcaseId = crypto.randomUUID()
          testcaseIds.set(key, testcaseId)
          await tx.problemTestcase.create({
            data: {
              id: testcaseId,
              problemId,
              inputFileId: inputFile.id,
              outputFileId: outputFile.id,
              source: /^hack_[0-9a-f-]+\.in$/i.test(testCase.input) ? 'hack' : 'official',
              inputSha256: inputFile.sha256,
              outputSha256: outputFile.sha256,
              orderIndex: testcaseIds.size - 1,
            },
          })
        }
        await tx.problemTestcaseGroup.create({
          data: {
            id: crypto.randomUUID(),
            testcaseId,
            groupId: officialGroupId,
            orderIndex: caseIndex,
            score: testCase.score,
            time: testCase.time,
            memory: testCase.memory,
          },
        })
      }
    }
    for (const [subtaskIndex, raw] of config.subtasks.entries()) {
      const sourceId = subtaskDbIds.get(legacySubtaskId(raw, subtaskIndex, config.subtasks.length))!
      for (const dep of raw.if || []) {
        await tx.problemSubtaskDependency.create({
          data: { id: crypto.randomUUID(), subtaskId: sourceId, dependsOnId: subtaskDbIds.get(Number(dep))! },
        })
      }
    }
    await tx.problem.update({ where: { id: problemId }, data: { testGraphRevision: 1 } })
  })
  return { ...inspected, alreadyMigrated: false, migrated: true }
}

export async function loadTestGraph(problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId }, select: { id: true, testGraphRevision: true } })
  if (!problem) return null
  const subtasks = await prisma.problemSubtask.findMany({
    where: { problemId },
    orderBy: { orderIndex: 'asc' },
    include: {
      Dependencies: { include: { DependsOn: true } },
      Groups: {
        orderBy: { orderIndex: 'asc' },
        include: {
          Testcases: {
            orderBy: { orderIndex: 'asc' },
            include: { Testcase: { include: { InputFile: true, OutputFile: true } } },
          },
        },
      },
    },
  })
  return {
    revision: problem.testGraphRevision,
    migrated: subtasks.length > 0,
    subtasks: subtasks.map(subtask => ({
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
        cases: group.Testcases.map(link => ({
          testcaseId: link.Testcase.id,
          input: link.Testcase.InputFile.filename,
          output: link.Testcase.OutputFile.filename,
          source: link.Testcase.source,
          score: link.score,
          time: link.time,
          memory: link.memory,
        })),
      })),
    })),
  }
}

export async function projectTestGraph(problemId: string, baseConfigText?: string | null): Promise<string | null> {
  const graph = await loadTestGraph(problemId)
  if (!graph?.migrated) return baseConfigText ?? null
  const problem = baseConfigText === undefined
    ? await prisma.problem.findUnique({ where: { id: problemId }, select: { judgeConfig: true } })
    : null
  const base = parseConfig(baseConfigText === undefined ? problem?.judgeConfig || null : baseConfigText)
  const subtasks = graph.subtasks.map(subtask => ({
    id: subtask.id,
    score: subtask.score,
    if: subtask.if,
    groups: subtask.groups.map(group => ({
      id: group.key,
      name: group.name,
      kind: group.kind,
      score: group.score,
      type: group.type,
      cases: group.cases.map(testCase => ({
        input: testCase.input,
        output: testCase.output,
        ...(testCase.score === null ? {} : { score: testCase.score }),
        ...(testCase.time ? { time: testCase.time } : {}),
        ...(testCase.memory ? { memory: testCase.memory } : {}),
      })),
    })),
  }))
  return yaml.dump({ ...base, mode: 'oi', subtasks }, { lineWidth: -1 })
}

export async function refreshProblemJudgeProjection(problemId: string) {
  const projected = await projectTestGraph(problemId)
  if (projected === null) return null
  return prisma.problem.update({ where: { id: problemId }, data: { judgeConfig: projected } })
}

export async function inspectAllOiGraphs() {
  const problems = await prisma.problem.findMany({
    where: { judgeConfig: { not: null } },
    select: { id: true, problemId: true, title: true },
    orderBy: { createdAt: 'asc' },
  })
  const valid: Array<{ problemId: string; problemNumber: string; title: string; alreadyMigrated: boolean }> = []
  const invalid: TestGraphIssue[] = []
  for (const item of problems) {
    const result = await inspectLegacyTestGraph(item.id)
    if (result.ok) valid.push({ problemId: item.id, problemNumber: item.problemId, title: item.title, alreadyMigrated: Boolean(result.alreadyMigrated) })
    else if (!result.issues.includes('不是 OI 评测配置')) invalid.push({ problemId: item.id, problemNumber: item.problemId, title: item.title, issues: result.issues })
  }
  return { valid, invalid, validCount: valid.length, invalidCount: invalid.length }
}


export async function replaceTestGraph(problemId: string, input: any) {
  const subtasks = Array.isArray(input?.subtasks) ? input.subtasks : []
  const issues: string[] = []
  const ids = new Set<number>()
  let total = 0
  for (const subtask of subtasks) {
    const id = Number(subtask.id)
    if (!Number.isInteger(id) || id <= 0 || ids.has(id)) issues.push(`Subtask ID ${subtask.id} 无效或重复`)
    ids.add(id)
    const score = Number(subtask.score)
    if (!Number.isInteger(score) || score < 0) issues.push(`Subtask ${id} 分值无效`)
    total += score || 0
    const groups = Array.isArray(subtask.groups) ? subtask.groups : []
    const official = groups.filter((group: any) => group.kind === 'official')
    const gates = groups.filter((group: any) => group.kind === 'hack_gate')
    if (gates.length !== 1) issues.push(`Subtask ${id} 必须恰好有一个 Hack Gate`)
    if (official.reduce((sum: number, group: any) => sum + Number(group.score || 0), 0) !== score) {
      issues.push(`Subtask ${id} 的 Official Group 分值之和必须等于 Subtask 分值`)
    }
    for (const group of groups) {
      if (!['official', 'hack_gate'].includes(group.kind)) issues.push(`Subtask ${id} Group 类型无效`)
      if (!['min', 'max', 'sum'].includes(group.type)) issues.push(`Subtask ${id} Group 聚合方式无效`)
      if (group.kind === 'hack_gate' && Number(group.score || 0) !== 0) issues.push(`Subtask ${id} Hack Gate 分值必须为 0`)
    }
  }
  if (total !== 100) issues.push(`Subtask 总分为 ${total}，必须为 100`)
  for (const subtask of subtasks) for (const dep of subtask.if || []) if (!ids.has(Number(dep))) issues.push(`Subtask ${subtask.id} 依赖不存在的 Subtask ${dep}`)
  const visiting = new Set<number>(), visited = new Set<number>()
  const byId = new Map<number, any>(subtasks.map((subtask: any) => [Number(subtask.id), subtask]))
  function visit(id: number): boolean {
    if (visiting.has(id)) return false
    if (visited.has(id)) return true
    visiting.add(id)
    for (const dep of byId.get(id)?.if || []) if (!visit(Number(dep))) return false
    visiting.delete(id); visited.add(id); return true
  }
  for (const id of ids) if (!visit(id)) { issues.push('Subtask 依赖不能形成环'); break }
  if (issues.length > 0) return { ok: false, issues: [...new Set(issues)] }

  const testcaseIds = [...new Set(subtasks.flatMap((subtask: any) => (subtask.groups || []).flatMap((group: any) => (group.cases || []).map((item: any) => item.testcaseId))))]
  const testcaseCount = await prisma.problemTestcase.count({ where: { problemId, id: { in: testcaseIds as string[] } } })
  if (testcaseCount !== testcaseIds.length) return { ok: false, issues: ['存在不属于当前题目的 Testcase'] }

  const current = await loadTestGraph(problemId)
  if (current?.migrated) {
    if (Number(input?.revision) !== current.revision) {
      return { ok: false, issues: ['测试图 revision 已变化，请刷新后重试'] }
    }
    const currentGates = new Map(current.subtasks.map(subtask => [subtask.id,
      subtask.groups.filter(group => group.kind === 'hack_gate').map(group => ({
        key: group.key,
        cases: group.cases.map(item => item.testcaseId),
      })),
    ]))
    for (const subtask of subtasks) {
      const submitted = (subtask.groups || []).filter((group: any) => group.kind === 'hack_gate').map((group: any) => ({
        key: String(group.key),
        cases: (group.cases || []).map((item: any) => String(item.testcaseId)),
      }))
      if (JSON.stringify(submitted) !== JSON.stringify(currentGates.get(Number(subtask.id)) || [])) {
        return { ok: false, issues: [`Subtask ${subtask.id} 的 Hack Gate 由系统维护，不能手动修改`] }
      }
    }
  }

  try {
    await prisma.$transaction(async tx => {
    await tx.problemSubtask.deleteMany({ where: { problemId } })
    const dbIds = new Map<number, string>()
    for (const [subtaskIndex, subtask] of subtasks.entries()) {
      const dbId = crypto.randomUUID()
      dbIds.set(Number(subtask.id), dbId)
      await tx.problemSubtask.create({ data: { id: dbId, problemId, subtaskId: Number(subtask.id), score: Number(subtask.score), orderIndex: subtaskIndex } })
      for (const [groupIndex, group] of (subtask.groups || []).entries()) {
        const groupId = crypto.randomUUID()
        await tx.problemTestGroup.create({ data: { id: groupId, problemId, subtaskId: dbId, key: String(group.key), name: String(group.name || group.key), kind: group.kind, score: Number(group.score || 0), aggregation: group.type, orderIndex: groupIndex } })
        for (const [caseIndex, item] of (group.cases || []).entries()) {
          await tx.problemTestcaseGroup.create({ data: { id: crypto.randomUUID(), testcaseId: item.testcaseId, groupId, orderIndex: caseIndex, score: item.score ?? null, time: item.time || null, memory: item.memory || null } })
        }
      }
    }
    for (const subtask of subtasks) for (const dep of subtask.if || []) {
      await tx.problemSubtaskDependency.create({ data: { id: crypto.randomUUID(), subtaskId: dbIds.get(Number(subtask.id))!, dependsOnId: dbIds.get(Number(dep))! } })
    }
      const changed = await tx.problem.updateMany({ where: { id: problemId, testGraphRevision: current?.revision ?? 0 }, data: { testGraphRevision: { increment: 1 } } })
      if (changed.count !== 1) throw new Error('TEST_GRAPH_STALE')
    })
  } catch (error: any) {
    if (error?.message === 'TEST_GRAPH_STALE') return { ok: false, issues: ['测试图 revision 已变化，请刷新后重试'] }
    throw error
  }
  await refreshProblemJudgeProjection(problemId)
  return { ok: true, graph: await loadTestGraph(problemId) }
}
