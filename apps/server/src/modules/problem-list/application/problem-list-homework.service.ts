import crypto from 'crypto'
import { getResourceScope, isPersonalContext } from '../../../middleware/auth'
import { prisma } from '../../../prisma'
import { ensureInitialTestSetRevision } from '../../problem/problem.testset-revision.service'
import { populateSnapshotData } from '../../training/training.helpers'
import { getProblemListPermission } from './problem-list-access.service'
import { ProblemListApplicationError } from './problem-list-crud.service'

type AuthUser = NonNullable<Express.Request['user']>

function fail(statusCode: number, message: string, code?: string): never {
  throw new ProblemListApplicationError(statusCode, message, code)
}

export async function publishProblemListHomework(user: AuthUser, problemListId: string, body: any) {
  if (isPersonalContext(user)) fail(403, '个人工作区不能发布校园作业', 'WORKSPACE_MODE_REQUIRED')
  if (user.role === 'student') fail(403, '学生不能发布作业')

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
  if (!team || team.scope !== getResourceScope(user)) fail(404, '团队不存在')
  const member = await prisma.teamMember.findFirst({
    where: { teamId, userId: user.userId, status: 'active', role: { in: ['owner', 'admin'] } },
    select: { id: true },
  })
  if (!member && user.role !== 'super_admin') fail(403, '只有团队管理员可以发布作业')

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
  if (!problemList) fail(404, '题单不存在')
  const entries = problemList.ProblemListSection.flatMap(section => section.ProblemListEntry)
  if (entries.length === 0) fail(400, '题单中没有题目，无法发布')

  for (const entry of entries) await ensureInitialTestSetRevision(entry.problemId, user.userId)
  const revisionProblems = await prisma.problem.findMany({
    where: { id: { in: entries.map(entry => entry.problemId) } },
    include: { LatestTestSetRevision: true },
  })
  const revisionByProblem = new Map(revisionProblems.map(problem => [problem.id, problem]))
  const homeworkTitle = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim()
    : `${problemList.title} - 作业`
  const result = await prisma.$transaction(async tx => {
    const training = await tx.training.create({
      data: {
        title: homeworkTitle,
        description: `由题单「${problemList.title}」发布`,
        teamId,
        organizationId: team.organizationId,
        scope: team.scope,
        type: 'homework',
        format: body.format || 'ioi',
        startTime: start,
        endTime: end,
        status: 'upcoming',
        createdBy: user.userId,
        problemIdVisible: false,
        solutionVisible: false,
        includeAdminInRanking: false,
      },
    })
    const problemsData = entries.map((entry, index) => ({
      id: crypto.randomUUID(),
      trainingId: training.id,
      problemId: entry.problemId,
      alias: entry.alias || String.fromCharCode(65 + index),
      orderIndex: index,
      points: null,
      ...populateSnapshotData({ ...entry.Problem, ...revisionByProblem.get(entry.problemId) }),
    }))
    await tx.trainingProblem.createMany({ data: problemsData })
    return { trainingId: training.id, problemCount: problemsData.length }
  })

  return { ...result, title: homeworkTitle }
}
