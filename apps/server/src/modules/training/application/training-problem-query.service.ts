import { prisma } from '../../../prisma'
import { latestContentSnapshot } from '../../problem/problem.content.service'
import {
  CURRENT_JUDGE_RUN_SELECT,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'
import { findActivityForAccess } from '../../contest/contest-query.facade'
import {
  contestProblemAsActivity,
  contestProblemInclude,
} from '../../contest/contest-activity-projection'

export async function findTrainingForProblemAccess(id: number, _includeTeam = false) {
  return (await findActivityForAccess(id))?.activity || null
}

async function findCanonicalContest(publicId: number) {
  return prisma.contest.findUnique({
    where: { publicId },
    select: { id: true, publicId: true },
  })
}

export async function listTrainingProblems(trainingId: number) {
  const contest = await findCanonicalContest(trainingId)
  if (contest) {
    const problems = await prisma.contestProblem.findMany({
      where: { contestId: contest.id },
      include: contestProblemInclude,
      orderBy: { orderIndex: 'asc' },
    })
    return problems.map(problem => contestProblemAsActivity(problem, contest.publicId))
  }
  return prisma.trainingProblem.findMany({
    where: { trainingId },
    include: {
      Problem: {
        select: {
          id: true, title: true, platform: true, problemId: true, difficulty: true,
          timeLimit: true, memoryLimit: true, statementType: true, description: true,
          ProblemStatement: { where: { isVisible: true } },
          _count: { select: { ProblemAttachment: true } },
        },
      },
      TrainingSolution: { select: { id: true, visible: true } },
      ContentSnapshot: {
        orderBy: [{ revision: 'desc' as const }, { selectedAt: 'desc' as const }],
        select: {
          kind: true, revision: true, sourceType: true, sourceContentId: true,
          authorUsernameSnapshot: true,
        },
      },
      _count: { select: { TrainingAttachment: true } },
    },
    orderBy: { orderIndex: 'asc' },
  })
}

export async function getTrainingProblemStatusData(trainingId: number, userId: string, submitScope: string) {
  const contest = await findCanonicalContest(trainingId)
  if (contest) {
    const [rows, submissions] = await Promise.all([
      prisma.contestProblem.findMany({
        where: { contestId: contest.id },
        include: contestProblemInclude,
        orderBy: { orderIndex: 'asc' },
      }),
      prisma.submission.findMany({
        where: { submitScope, canonicalContestId: contest.id, userId },
        include: { CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT } },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    return {
      problems: rows.map(problem => contestProblemAsActivity(problem, contest.publicId)),
      submissions: submissions.map(projectSubmissionJudgeResult),
    }
  }
  const [problems, submissions] = await Promise.all([
    prisma.trainingProblem.findMany({
      where: { trainingId },
      include: { Problem: { select: { id: true, title: true, platform: true, problemId: true } } },
      orderBy: { orderIndex: 'asc' },
    }),
    prisma.submission.findMany({
      where: { submitScope, trainingId, userId },
      include: { CurrentJudgeRun: { select: CURRENT_JUDGE_RUN_SELECT } },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  return { problems, submissions: submissions.map(projectSubmissionJudgeResult) }
}

export async function getTrainingProblemDetailData(
  trainingId: number,
  trainingProblemId: string,
  userId: string,
  userType: string,
) {
  const contest = await findCanonicalContest(trainingId)
  if (contest) {
    const row = await prisma.contestProblem.findUnique({
      where: { id: trainingProblemId },
      include: contestProblemInclude,
    })
    if (!row || row.contestId !== contest.id) return null
    const trainingProblem = contestProblemAsActivity(row, contest.publicId)
    const note = row.canonicalProblemId
      ? await prisma.problemNote.findUnique({
          where: { problemId_userId_userType: { problemId: row.canonicalProblemId, userId, userType } },
          select: { content: true },
        })
      : null
    return {
      trainingProblem,
      note,
      statementSet: null,
      legacyStatementSnapshot: null,
    }
  }

  const trainingProblem = await prisma.trainingProblem.findUnique({
    where: { id: trainingProblemId },
    include: {
      Problem: {
        select: {
          id: true, title: true, description: true, statementType: true, statementPdfUrl: true,
          difficulty: true, timeLimit: true, memoryLimit: true, platform: true, problemId: true,
          ProblemStatement: { where: { isVisible: true } },
        },
      },
    },
  })
  if (!trainingProblem || trainingProblem.trainingId !== trainingId) return null
  const [note, statementSet, legacyStatementSnapshot] = await Promise.all([
    prisma.problemNote.findUnique({
      where: { problemId_userId_userType: { problemId: trainingProblem.problemId, userId, userType } },
      select: { content: true },
    }),
    prisma.trainingProblemStatementSet.findFirst({
      where: { trainingProblemId }, orderBy: { revision: 'desc' },
      include: { Snapshot: { orderBy: [{ isDefault: 'desc' }, { orderIndex: 'asc' }] } },
    }),
    latestContentSnapshot(trainingProblemId, 'statement'),
  ])
  return { trainingProblem, note, statementSet, legacyStatementSnapshot }
}
