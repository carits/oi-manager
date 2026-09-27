import type { Prisma } from '@prisma/client'

export const contestProblemInclude = {
  CanonicalProblem: {
    select: {
      id: true, title: true, platform: true, problemId: true, difficulty: true,
      timeLimit: true, memoryLimit: true, statementType: true, statementPdfUrl: true,
      solutionType: true, solutionMarkdown: true, solutionPdfUrl: true,
      description: true, judgeConfig: true, allowedLanguages: true,
      ProblemStatement: { where: { isVisible: true } },
      _count: { select: { ProblemAttachment: true } },
    },
  },
  ContestResource: true,
  TestSetReader: { include: { Slot: true } },
} satisfies Prisma.ContestProblemInclude

export const contestInclude = {
  Team: true,
  RatingConfig: true,
  ContestProblem: { include: contestProblemInclude, orderBy: { orderIndex: 'asc' } },
  _count: { select: { ContestProblem: true, ContestParticipant: true } },
} satisfies Prisma.ContestInclude

export type ContestViewRecord = Prisma.ContestGetPayload<{ include: typeof contestInclude }>

export function toContestProblemView(problem: any, publicContestId: number) {
  const canonical = problem.CanonicalProblem
  const resources = Array.isArray(problem.ContestResource) ? problem.ContestResource : []
  const attachments = resources.filter((resource: any) => !['statement', 'solution'].includes(resource.fileType))
  return {
    id: problem.id,
    contestId: publicContestId,
    canonicalProblemId: problem.canonicalProblemId,
    alias: problem.alias,
    orderIndex: problem.orderIndex,
    points: problem.points,
    title: problem.title || canonical?.title || null,
    statementType: problem.statementType,
    statementMarkdown: problem.statementMarkdown,
    solutionType: problem.solutionType,
    solutionMarkdown: problem.solutionMarkdown,
    solutionVisible: problem.solutionVisible,
    testSetSlot: problem.testSetSlot,
    testSetGraphHash: problem.testSetGraphHash,
    testSetFencingToken: problem.testSetFencingToken,
    sourcePlatform: problem.ojName || canonical?.platform || null,
    sourceProblemId: problem.problemId || canonical?.problemId || null,
    timeLimit: canonical?.timeLimit ?? null,
    memoryLimit: canonical?.memoryLimit ?? null,
    judgeConfig: problem.TestSetReader?.Slot?.judgeConfig || canonical?.judgeConfig || null,
    allowedLanguages: canonical?.allowedLanguages || null,
    createdAt: problem.createdAt,
    updatedAt: problem.updatedAt,
    Problem: canonical,
    ContestResource: resources,
    ContestSolution: problem.solutionMarkdown === null && problem.solutionType === 'none'
      ? null
      : { id: `contest-solution:${problem.id}`, visible: problem.solutionVisible, content: problem.solutionMarkdown || '' },
    ContestAttachment: attachments,
    _count: { ContestAttachment: attachments.length },
  }
}

export function toContestView(contest: any) {
  const problems = Array.isArray(contest.ContestProblem)
    ? contest.ContestProblem.map((problem: any) => toContestProblemView(problem, contest.publicId))
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
