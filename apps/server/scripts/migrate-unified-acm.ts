import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'
import yaml from 'js-yaml'
import { PrismaClient, Prisma } from '@prisma/client'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })
const prisma = new PrismaClient()

const accepted = new Set(['Accepted', 'AC', 'accepted', 'ac'])
const pending = new Set(['queuing', 'Judging', 'judging', 'pending', ''])

function outcome(result?: string | null): 'accepted' | 'failed' | 'pending' {
  if (!result || pending.has(result)) return 'pending'
  return accepted.has(result) ? 'accepted' : 'failed'
}

function scoreOf(result?: string | null): number | null {
  const value = outcome(result)
  return value === 'pending' ? null : value === 'accepted' ? 100 : 0
}

function normalizeCases(raw: string | null): string | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return raw
  }
  if (!Array.isArray(parsed)) return raw
  return JSON.stringify(parsed.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const record = item as Record<string, unknown>
    if (record.result === 'Skipped') return { ...record, score: null }
    return { ...record, score: scoreOf(record.result as string | null) }
  }))
}

function stripScores(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripScores)
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'score' || key === 'if') continue
      output[key] = stripScores(item)
    }
    return output
  }
  return value
}

async function writeSnapshot() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.resolve(process.cwd(), 'backups', 'unified-acm', stamp)
  fs.mkdirSync(dir, { recursive: true })

  async function write(name: string, records: Record<string, unknown>[]) {
    const target = path.join(dir, name)
    const stream = fs.createWriteStream(target)
    stream.write('[')
    for (let i = 0; i < records.length; i++) {
      stream.write(JSON.stringify(records[i]))
      if (i !== records.length - 1) stream.write(',')
    }
    stream.write(']')
    await new Promise(resolve => stream.end(resolve))
  }

  await write('submissions.json', await prisma.submission.findMany({
    select: { id: true, score: true, cases: true, subtasks: true },
  }))
  await write('training-status.json', await prisma.trainingUserProblemStatus.findMany({
    select: { id: true, bestScore: true },
  }))
  await write('contest-status.json', await prisma.contestUserProblemStatus.findMany({
    select: { id: true, bestScore: true, frozenScore: true },
  }))
  await write('problems.json', await prisma.problem.findMany({
    select: { id: true, judgeConfig: true },
  }))
  return dir
}

async function migrateProblems(tx: Prisma.TransactionClient) {
  const problems = await tx.problem.findMany({ select: { id: true, judgeConfig: true } })
  let converted = 0
  for (const problem of problems) {
    if (!problem.judgeConfig) continue
    let config: unknown
    try {
      config = yaml.load(problem.judgeConfig)
    } catch {
      continue
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) continue
    const record = { ...(config as Record<string, unknown>) }
    let cases = Array.isArray(record.cases) ? record.cases : []
    if (!cases.length && Array.isArray(record.subtasks)) {
      const seen = new Set<string>()
      cases = (record.subtasks as unknown[])
        .flatMap(item => Array.isArray((item as { cases?: unknown[] })?.cases) ? (item as { cases: unknown[] }).cases : [])
        .filter(item => {
          const input = (item as { input?: unknown })?.input
          const output = (item as { output?: unknown })?.output
          if (typeof input !== 'string' || typeof output !== 'string') return false
          const key = input + '\0' + output
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map(item => {
          const source = item as Record<string, unknown>
          const output: Record<string, unknown> = { input: source.input, output: source.output }
          if (typeof source.time === 'string') output.time = source.time
          if (typeof source.memory === 'string') output.memory = source.memory
          return output
        })
    }
    const next = stripScores({ ...record, mode: 'acm', cases }) as Record<string, unknown>
    delete next.subtasks
    const serialized = yaml.dump(next, { lineWidth: -1 })
    if (serialized !== problem.judgeConfig) {
      await tx.problem.update({ where: { id: problem.id }, data: { judgeConfig: serialized } })
      converted++
    }
  }
  return { total: problems.length, converted }
}

async function migrateSubmissions(tx: Prisma.TransactionClient) {
  const pendingResults = ['queuing', 'Judging', 'judging', 'pending', '']
  let changed = 0
  for (;;) {
    const records = await tx.submission.findMany({
      where: {
        result: { notIn: pendingResults },
        OR: [{ score: { notIn: [0, 100] } }, { score: null }],
      },
      select: { id: true, result: true, cases: true },
      take: 500,
    })
    if (!records.length) break
    for (const record of records) {
      await tx.submission.update({
        where: { id: record.id },
        data: {
          score: scoreOf(record.result),
          cases: normalizeCases(record.cases),
          subtasks: null,
        },
      })
    }
    changed += records.length
  }
  const waiting = await tx.submission.count({
    where: { result: { in: ['queuing', 'Judging', 'judging', 'pending', ''] } },
  })
  return { total: await tx.submission.count(), changed, waiting }
}

async function migrateStatuses(tx: Prisma.TransactionClient) {
  const trainingTotal = await tx.trainingUserProblemStatus.count()
  let trainingChanged = 0
  for (;;) {
    const records = await tx.trainingUserProblemStatus.findMany({
      where: { OR: [{ bestScore: { notIn: [0, 100] } }, { bestScore: null }] },
      select: { id: true, bestResult: true },
      take: 500,
    })
    if (!records.length) break
    for (const record of records) {
      await tx.trainingUserProblemStatus.update({
        where: { id: record.id },
        data: { bestScore: scoreOf(record.bestResult) },
      })
    }
    trainingChanged += records.length
  }

  const contestTotal = await tx.contestUserProblemStatus.count()
  let contestChanged = 0
  for (;;) {
    const records = await tx.contestUserProblemStatus.findMany({
      where: {
        OR: [
          { bestScore: { notIn: [0, 100] } },
          { bestScore: null },
          { frozenScore: { notIn: [0, 100] } },
          { frozenScore: null },
        ],
      },
      select: { id: true, bestResult: true, frozenResult: true },
      take: 500,
    })
    if (!records.length) break
    for (const record of records) {
      await tx.contestUserProblemStatus.update({
        where: { id: record.id },
        data: {
          bestScore: scoreOf(record.bestResult),
          frozenScore: scoreOf(record.frozenResult ?? record.bestResult),
        },
      })
    }
    contestChanged += records.length
  }
  return {
    trainingUserProblemStatus: { total: trainingTotal, changed: trainingChanged },
    contestUserProblemStatus: { total: contestTotal, changed: contestChanged },
  }
}

async function main() {
  const snapshotDir = await writeSnapshot()
  const migration = await prisma.$transaction(async tx => ({
    problems: await migrateProblems(tx),
    submissions: await migrateSubmissions(tx),
    statuses: await migrateStatuses(tx),
  }))
  const partialScores = await prisma.submission.count({
    where: { score: { gt: 0, lt: 100 } },
  })
  const residualOi = await prisma.problem.count({
    where: { judgeConfig: { contains: 'mode: oi' } },
  })
  console.log(JSON.stringify({ snapshotDir, migration, partialScores, residualOi }, null, 2))
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
