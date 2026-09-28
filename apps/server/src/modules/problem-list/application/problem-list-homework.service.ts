import { getResourceScope, isPersonalContext } from '../../../middleware/auth'
import { prisma } from '../../../prisma'
import { ensureInitialTestSetSlots } from '../../problem/problem.testset-slot.service'
import { getProblemListPermission } from './problem-list-access.service'
import { ProblemListApplicationError } from './problem-list-crud.service'
import { judgeMaxScoreFromSnapshot } from '../../assignment/assignment-grading'
import { resolveOrganizationAuthorization } from '../../authorization/capabilities'

type AuthUser = NonNullable<Express.Request['user']>

function fail(statusCode: number, message: string, code?: string): never {
  throw new ProblemListApplicationError(statusCode, message, code)
}

export async function createAssignmentFromProblemList(user: AuthUser, problemListId: string, body: any) {
  if (isPersonalContext(user)) fail(403, '个人工作区不能发布校园作业', 'WORKSPACE_MODE_REQUIRED')

  const teamId = typeof body.teamId === 'string' ? body.teamId : ''
  const startTime = typeof body.startTime === 'string' ? body.startTime : ''
  const endTime = typeof body.endTime === 'string' ? body.endTime : ''
  if (!teamId) fail(400, '必须选择团队')
  if (!startTime || !endTime) fail(400, '必须设置开始和结束时间')
  const start = new Date(startTime)
  const end = new Date(endTime)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    fail(400, '作业时间范围无效')
  }

  const permission = await getProblemListPermission(problemListId, user)
  if (!permission || permission === 'view') fail(403, '需要编辑权限才能发布作业')

  const team = await prisma.team.findUnique({ where: { id: teamId } })
  if (!team
    || !team.organizationId
    || team.scope !== getResourceScope(user)
    || !user.organizationId
    || team.organizationId !== user.organizationId) fail(404, '团队不存在')
  const organizationId = team.organizationId
  const [member, creatorAuthorization] = await Promise.all([prisma.teamMember.findFirst({
    where: { teamId, userId: user.userId, status: 'active', role: { in: ['owner', 'admin'] } },
    select: { id: true },
  }), resolveOrganizationAuthorization(user.userId, organizationId)])
  if (!member) fail(403, '只有团队管理员可以创建作业')
  if (!creatorAuthorization?.capabilities.has('assignment.create')) {
    fail(403, '当前身份没有创建作业的权限')
  }

  const problemList = await prisma.problemList.findUnique({
    where: { id: problemListId },
    include: {
      ProblemListSection: {
        orderBy: { sortOrder: 'asc' },
        include: {
          ProblemListEntry: {
            orderBy: { sortOrder: 'asc' },
            include: { Problem: { include: { ProblemStatement: { where: { isVisible: true } } } } },
          },
        },
      },
    },
  })
  if (!problemList
    || problemList.scope !== 'campus'
    || problemList.organizationId !== organizationId) fail(404, '题单不存在')
  const entries = problemList.ProblemListSection.flatMap(section => section.ProblemListEntry)
  if (entries.length === 0) fail(400, '题单中没有题目，无法发布')

  for (const entry of entries) await ensureInitialTestSetSlots(entry.problemId, user.userId)
  const stableSlots = await prisma.problemTestSetSlot.findMany({
    where: { problemId: { in: entries.map(entry => entry.problemId) }, slot: 'STABLE' },
  })
  const stableByProblem = new Map(stableSlots.map(slot => [slot.problemId, slot]))
  const homeworkTitle = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim()
    : `${problemList.title} - 作业`
  const result = await prisma.$transaction(async tx => {
    const assignment = await tx.assignment.create({
      data: {
        title: homeworkTitle,
        description: `由题单「${problemList.title}」发布`,
        teamId,
        organizationId,
        rosterMode: 'DYNAMIC',
        gradingPolicy: 'BEST_BEFORE_DUE',
        latePolicy: 'DISALLOW',
        correctionPolicy: 'NONE',
        solutionReleasePolicy: 'AFTER_RELEASE',
        openAt: start,
        dueAt: end,
        closeAt: end,
        createdByMembershipId: creatorAuthorization.membershipId,
        eventSeq: 1,
      },
    })
    const problemsData = entries.map((entry, index) => {
      const stable = stableByProblem.get(entry.problemId)
      if (!stable) fail(422, `题目 ${entry.Problem.problemId} 没有可用的 Stable 测试数据`)
      return {
        assignmentId: assignment.id,
        problemId: entry.problemId,
        orderIndex: index,
        category: 'REQUIRED' as const,
        required: true,
        maxScore: 100,
        judgeMaxScore: judgeMaxScoreFromSnapshot(stable.judgeConfig, stable.mode),
        targetScore: 100,
        weight: 100,
        completionPolicy: stable.mode === 'acm' ? 'AC' as const : 'TARGET_SCORE' as const,
        judgeConfigSnapshot: stable.judgeConfig,
        judgeConfigHash: stable.judgeConfigHash,
        settings: { sourceProblemListId: problemList.id, sourceProblemListEntryId: entry.id, alias: entry.alias },
      }
    })
    await tx.assignmentProblem.createMany({ data: problemsData })
    await tx.assignmentEvent.create({
      data: {
        assignmentId: assignment.id,
        seq: 1,
        type: 'assignment.created_from_problem_list',
        actorUserId: user.userId,
        payload: { problemListId: problemList.id, teamId, problemCount: problemsData.length },
      },
    })
    return { assignmentId: assignment.id, problemCount: problemsData.length, status: assignment.status }
  })

  return { ...result, title: homeworkTitle }
}
