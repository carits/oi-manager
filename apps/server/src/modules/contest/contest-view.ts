import type { Prisma } from '@prisma/client'

export const contestProblemInclude = {
  CanonicalProblem: {
    select: {
      id: true,
      title: true,
      platform: true,
      problemId: true,
      difficulty: true,
      timeLimit: true,
      memoryLimit: true,
      statementType: true,
      description: true,
      ProblemStatement: { where: { isVisible: true } },
      _count: { select: { ProblemAttachment: true } },
    },
  },
  ContestResource: true,
} satisfies Prisma.ContestProblemInclude

export const contestInclude = {
  Team: true,
  RatingConfig: true,
  ContestProblem: {
    include: contestProblemInclude,
    orderBy: { orderIndex: 'asc' },
  },
  _count: {
    select: {
      ContestProblem: true,
      ContestParticipant: true,
    },
  },
} satisfies Prisma.ContestInclude

export type ContestViewRecord = Prisma.ContestGetPayload<{
  include: typeof contestInclude
}>

export function contestProblemAsView(problem: any, publicContestId: number) {
  const canonical = problem.CanonicalProblem
  const attachments = Array.isArray(problem.ContestResource)
    ? problem.ContestResource.filter((resource: any) => resource.fileType !== 'solution')
    : []
  return {
    id: problem.id,
    contestId: publicContestId,
    problemId: problem.canonicalProblemId || canonical?.id || problem.problemId,
    alias: problem.alias,
    orderIndex: problem.orderIndex,
    points: problem.points,
    createdAt: problem.createdAt,
    dataVersion: null,
    snapshotCreatedAt: problem.updatedAt,
    statementSnapshot: problem.statementMarkdown,
    titleSnapshot: problem.title,
    statementsSnapshotJson: null,
    timeLimitSnapshot: canonical?.timeLimit ?? null,
    memoryLimitSnapshot: canonical?.memoryLimit ?? null,
    judgeConfigSnapshot: null,
    testGraphRevisionSnapshot: null,
    testSetRevisionId: problem.testSetRevisionId,
    allowedLanguagesSnapshot: null,
    sourcePlatformSnapshot: problem.ojName || canonical?.platform || null,
    sourceProblemIdSnapshot: problem.problemId || canonical?.problemId || null,
    sourceUrlSnapshot: null,
    Problem: canonical ? {
      ...canonical,
      title: problem.title || canonical.title,
      platform: problem.ojName || canonical.platform,
      problemId: problem.problemId || canonical.problemId,
      difficulty: problem.difficulty || canonical.difficulty,
    } : null,
    TestSetRevision: problem.TestSetRevision || null,
    ContestSolution: problem.solutionMarkdown === null && problem.solutionType === 'none'
      ? null
      : {
          id: `contest-solution:${problem.id}`,
          visible: problem.solutionVisible,
          content: problem.solutionMarkdown || '',
        },
    ContentSnapshot: [],
    StatementSet: [],
    ContestAttachment: attachments,
    _count: { ContestAttachment: attachments.length },
  }
}

export function contestAsView(contest: any) {
  const problems = Array.isArray(contest.ContestProblem)
    ? contest.ContestProblem.map((problem: any) => contestProblemAsView(problem, contest.publicId))
    : undefined
  return {
    id: contest.publicId,
    canonicalContestId: contest.id,
    teamId: contest.teamId,
    organizationId: contest.organizationId,
    title: contest.title,
    description: contest.description,
    format: contest.format || 'ioi',
    type: 'contest',
    startTime: contest.startAt || contest.contestDate,
    endTime: contest.endAt || contest.contestDate,
    status: contest.status,
    createdBy: contest.createdBy || '',
    problemIdVisible: contest.problemIdVisible,
    solutionVisible: contest.solutionVisible,
    includeAdminInRanking: contest.includeAdminInRanking,
    scope: contest.scope,
    finalizationStatus: contest.finalizationStatus,
    finalizedStandingId: contest.finalizedStandingId,
    createdAt: contest.createdAt,
    updatedAt: contest.updatedAt,
    Team: contest.Team || null,
    RatingConfig: contest.RatingConfig || null,
    ...(problems ? { ContestProblem: problems } : {}),
    _count: {
      ContestProblem: contest._count?.ContestProblem ?? problems?.length ?? 0,
      ContestParticipant: contest._count?.ContestParticipant ?? 0,
    },
  }
}
