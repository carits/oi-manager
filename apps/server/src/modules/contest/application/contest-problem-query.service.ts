import { prisma } from '../../../prisma'
import {
  CURRENT_JUDGE_RUN_SELECT,
  projectSubmissionJudgeResult,
} from '../../judge/application/judge-read-projection'
import { findContestForAccess } from '../../contest/contest-query.facade'
import {
  toContestProblemView,
  contestProblemInclude,
} from '../../contest/contest-view'

export async function findContestForProblemAccess(id: number, _includeTeam = false) {
  return (await findContestForAccess(id))?.contest || null
}

async function findCanonicalContest(publicId: number) {
  return prisma.contest.findUnique({
    where: { publicId },
    select: { id: true, publicId: true },
  })
}

export async function listContestProblems(contestId: number) {
  const contest = await findCanonicalContest(contestId)
  if (!contest) return []
  const problems = await prisma.contestProblem.findMany({
    where: { contestId: contest.id },
    include: contestProblemInclude,
    orderBy: { orderIndex: 'asc' },
  })
  return problems.map(problem => toContestProblemView(problem, contest.id))
}

export async function getContestProblemStatusData(contestId: number, userId: string, submitScope: string) {
  const contest = await findCanonicalContest(contestId)
  if (!contest) return { problems: [], submissions: [] }
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
    problems: rows.map(problem => toContestProblemView(problem, contest.id)),
    submissions: submissions.map(projectSubmissionJudgeResult),
  }
}

export async function getContestProblemDetailData(
  contestId: number,
  contestProblemId: string,
  userId: string,
  userType: string,
) {
  const contest = await findCanonicalContest(contestId)
  if (contest) {
    const row = await prisma.contestProblem.findUnique({
      where: { id: contestProblemId },
      include: contestProblemInclude,
    })
    if (!row || row.contestId !== contest.id) return null
    const contestProblem = toContestProblemView(row, contest.id)
    const note = row.canonicalProblemId
      ? await prisma.problemNote.findUnique({
          where: { problemId_userId_userType: { problemId: row.canonicalProblemId, userId, userType } },
          select: { content: true },
        })
      : null
    return {
      contestProblem,
      note,
      statementSet: null,
      legacyStatementSnapshot: null,
    }
  }

  return null
}
