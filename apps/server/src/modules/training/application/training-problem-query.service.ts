import { prisma } from '../../../prisma'
import { latestContentSnapshot } from '../../problem/problem.content.service'
import {
  CURRENT_JUDGE_RUN_SELECT,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'

export function findTrainingForProblemAccess(id: number, includeTeam = false) {
  return prisma.training.findUnique({
    where: { id },
    ...(includeTeam ? { include: { Team: { select: { organizationId: true, scope: true } } } } : {}),
  })
}

export function listTrainingProblems(trainingId: number) {
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
