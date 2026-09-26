import crypto from 'node:crypto'
import { prisma } from '../../src/prisma'

interface CreateTestSchoolContestOptions {
  organizationId: string
  createdBy: string
  title?: string
  description?: string
  format?: 'ioi' | 'icpc' | 'oi'
  startTime?: Date
  endTime?: Date
  status?: 'upcoming' | 'ongoing' | 'finished'
  problemIdVisible?: boolean
  solutionVisible?: boolean
  includeAdminInRanking?: boolean
  teamId?: string | null
}

export async function createTestSchoolContest(options: CreateTestSchoolContestOptions) {
  const now = Date.now()
  const startAt = options.startTime ?? new Date(now - 3_600_000)
  const endAt = options.endTime ?? new Date(now + 3_600_000)
  return prisma.contest.create({
    data: {
      id: crypto.randomUUID(),
      organizationId: options.organizationId,
      teamId: options.teamId ?? null,
      title: options.title ?? '测试校级比赛',
      description: options.description,
      format: options.format ?? 'ioi',
      type: 'judged',
      contestDate: startAt,
      startAt,
      endAt,
      status: options.status ?? 'ongoing',
      scope: 'campus',
      problemIdVisible: options.problemIdVisible ?? false,
      solutionVisible: options.solutionVisible ?? false,
      includeAdminInRanking: options.includeAdminInRanking ?? false,
      createdBy: options.createdBy,
    },
  })
}

export async function createTestContestProblem(options: {
  ownerId: string
  platform?: string
  problemId?: string
  title?: string
}) {
  const problemId = options.problemId ?? `TEST_P_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  return prisma.problem.create({
    data: {
      id: crypto.randomUUID(),
      platform: options.platform ?? 'carits',
      problemId,
      title: options.title ?? '测试题目',
      ownerId: options.ownerId,
      visibility: 'public',
      libraryScope: 'platform',
      libraryKey: 'platform',
      status: 'published',
      publishedAt: new Date(),
    },
  })
}

export async function addProblemToContest(options: {
  contestId: string
  problemId: string
  alias?: string
  points?: number
  orderIndex?: number
}) {
  const problem = await prisma.problem.findUniqueOrThrow({ where: { id: options.problemId } })
  return prisma.contestProblem.create({
    data: {
      id: crypto.randomUUID(),
      contestId: options.contestId,
      canonicalProblemId: problem.id,
      alias: options.alias,
      orderIndex: options.orderIndex ?? 1,
      points: options.points ?? 100,
      title: problem.title,
      ojName: problem.platform,
      problemId: problem.problemId,
      difficulty: problem.difficulty,
    },
  })
}

export async function createTestSubmission(options: {
  userId: string
  contestId: string
  problemId: string
  contestProblemId: string
  result?: string
  score?: number
  timeUsed?: number
  memoryUsed?: number
  oj?: string
  cases?: string
  createdAt?: Date
}) {
  const [contest, contestProblem] = await Promise.all([
    prisma.contest.findUniqueOrThrow({ where: { id: options.contestId } }),
    prisma.contestProblem.findUniqueOrThrow({ where: { id: options.contestProblemId } }),
  ])
  const submission = await prisma.submission.create({
    data: {
      userId: options.userId,
      oj: options.oj ?? 'carits',
      problemId: options.problemId,
      language: 'cpp',
      code: '#include <iostream>\nint main() { return 0; }',
      codeLength: 50,
      submitScope: 'contest',
      canonicalContestId: contest.id,
      canonicalContestProblemId: contestProblem.id,
      submitMethod: 'local',
      workspaceScope: contest.scope,
      organizationId: contest.organizationId,
      problemInternalId: contestProblem.canonicalProblemId,
      isGlobalVisible: false,
      createdAt: options.createdAt ?? new Date(),
    },
  })
  const runId = crypto.randomUUID()
  await prisma.judgeRun.create({
    data: {
      id: runId,
      submissionId: submission.id,
      runNumber: 1,
      runType: 'NORMAL',
      status: 'FINALIZED',
      result: options.result ?? 'accepted',
      score: options.score ?? 100,
      timeUsed: options.timeUsed ?? 100,
      memoryUsed: options.memoryUsed ?? 1024,
      cases: options.cases ?? JSON.stringify([{ status: 'accepted', time: 100, memory: 1024 }]),
      finalizedAt: options.createdAt ?? new Date(),
    },
  })
  await prisma.submission.update({ where: { id: submission.id }, data: { currentJudgeRunId: runId } })
  return submission
}
