/**
 * School Contest Routes
 * 校级比赛 CRUD 路由
 */

import crypto from 'crypto'
import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'
import { authenticate, requireWorkspace } from '../../middleware/auth'
import { logger } from '../../lib/logger'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import {
  isSchoolMember,
  isSchoolContestAdmin,
  parseTrainingId,
  getComputedTrainingStatus,
  sortTrainingListForDisplay,
} from '../training/training.helpers'

export const schoolContestRouter = Router()

schoolContestRouter.use(authenticate, requireWorkspace('work'))

const demoContestIds = [9801, 9802, 9803, 9804, 9805, 9806, 9807, 9808, 9809]
const demoContestSeeds = [
  ['oi', 'ongoing', '[演示] OI 模拟赛 - 正在进行', -1, 5], ['oi', 'finished', '[演示] OI 模拟赛 - 已结束', -72, -48], ['oi', 'upcoming', '[演示] OI 模拟赛 - 即将开始', 48, 54],
  ['ioi', 'ongoing', '[演示] IOI 选拔赛 - 正在进行', -2, 4], ['ioi', 'finished', '[演示] IOI 选拔赛 - 已结束', -96, -72], ['ioi', 'upcoming', '[演示] IOI 选拔赛 - 即将开始', 72, 78],
  ['icpc', 'ongoing', '[演示] ICPC 校队赛 - 正在进行', -3, 2], ['icpc', 'finished', '[演示] ICPC 校队赛 - 已结束', -120, -115], ['icpc', 'upcoming', '[演示] ICPC 校队赛 - 即将开始', 96, 101],
] as const

const demoTime = (offsetHours: number) => new Date(Date.now() + offsetHours * 3600 * 1000)
const demoCases = (result: string, score: number, timeUsed: number, memoryUsed: number) => JSON.stringify([{ caseId: 1, result, score, timeUsed, memoryUsed }])

async function createDemoContestData(schoolId: string, createdBy: string) {
  const existing = await prisma.training.findMany({ where: { id: { in: demoContestIds } }, select: { id: true, title: true } })
  const unsafe = existing.find(item => !item.title.startsWith('[演示]'))
  if (unsafe) throw new Error(`演示编号 ${unsafe.id} 已被普通比赛占用`)
  const otherSchoolDemo = await prisma.training.findFirst({ where: { id: { in: demoContestIds }, schoolId: { not: schoolId } }, select: { id: true } })
  if (otherSchoolDemo) throw new Error('这组演示比赛已属于另一所学校')
  const students = await prisma.user.findMany({ where: { schoolId, role: 'student', status: 'active' }, orderBy: { username: 'asc' }, take: 3, select: { id: true, username: true } })
  if (students.length < 3) throw new Error('至少需要三名本校学生才能生成演示数据')
  let problems = await prisma.problem.findMany({ where: { schoolId, status: { in: ['published', 'draft'] } }, orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, problemId: true } })
  for (let index = problems.length; index < 3; index += 1) {
    const problemId = `DEMO-CONTEST-${index + 1}`
    problems.push(await prisma.problem.upsert({
      where: { libraryKey_platform_problemId: { libraryKey: schoolId, platform: 'carits', problemId } },
      create: { id: crypto.randomUUID(), platform: 'carits', problemId, title: `演示题目 ${String.fromCharCode(65 + index)}`, description: '比赛界面演示题目。', ownerId: createdBy, ownerType: 'teacher', libraryScope: 'school', libraryKey: schoolId, schoolId, status: 'published', visibility: 'school', timeLimit: 1000, memoryLimit: 256 },
      update: { status: 'published' }, select: { id: true, problemId: true },
    }))
  }
  await prisma.submission.deleteMany({ where: { sourceId: { startsWith: 'demo-contest:' } } })
  for (const [index, [format, status, title, startOffset, endOffset]] of demoContestSeeds.entries()) {
    const id = demoContestIds[index]
    const training = await prisma.training.upsert({
      where: { id },
      create: { id, title, description: '用于查看比赛、提交记录和排名效果的演示数据。', format, type: 'contest', scope: 'campus', schoolId, createdBy, startTime: demoTime(startOffset), endTime: demoTime(endOffset), status, problemIdVisible: true, solutionVisible: status === 'finished' },
      update: { title, description: '用于查看比赛、提交记录和排名效果的演示数据。', format, type: 'contest', scope: 'campus', schoolId, createdBy, startTime: demoTime(startOffset), endTime: demoTime(endOffset), status, problemIdVisible: true, solutionVisible: status === 'finished' },
    })
    const trainingProblems = await Promise.all(problems.map((problem, problemIndex) => prisma.trainingProblem.upsert({
      where: { trainingId_orderIndex: { trainingId: id, orderIndex: problemIndex } },
      create: { id: `demo-training-${id}-problem-${problemIndex}`, trainingId: id, problemId: problem.id, alias: String.fromCharCode(65 + problemIndex), orderIndex: problemIndex, points: 100 },
      update: { problemId: problem.id, alias: String.fromCharCode(65 + problemIndex), points: 100 }, select: { id: true },
    })))
    if (status === 'upcoming') continue
    for (const [studentIndex, student] of students.entries()) for (const [problemIndex, trainingProblem] of trainingProblems.entries()) {
      const accepted = format === 'icpc' ? (studentIndex + problemIndex) % 3 !== 2 : (studentIndex * 2 + problemIndex) % 4 !== 3
      const score = accepted ? (format === 'ioi' && studentIndex === 1 && problemIndex === 1 ? 60 : 100) : 0
      const timeUsed = 32 + studentIndex * 19 + problemIndex * 7
      const memoryUsed = 768 + studentIndex * 256 + problemIndex * 128
      const createdAt = new Date(demoTime(startOffset).getTime() + (20 + studentIndex * 24 + problemIndex * 11) * 60000)
      await prisma.submission.create({ data: { userId: student.id, oj: 'carits', problemId: problems[problemIndex].problemId, language: 'cpp', code: '// 比赛演示提交', codeLength: 30, result: accepted ? 'accepted' : 'wrong_answer', score, timeUsed, wallTimeUsed: timeUsed + 3, memoryUsed, cases: demoCases(accepted ? 'accepted' : 'wrong_answer', score, timeUsed, memoryUsed), metricSource: 'demo', submitMethod: 'demo', submitSource: 'contest', submitScope: 'contest', workspaceScope: 'campus', sourceId: `demo-contest:${id}`, trainingId: id, trainingProblemId: trainingProblem.id, contestId: id, contestProblemId: trainingProblem.id, isGlobalVisible: true, createdAt, updatedAt: createdAt } })
    }
  }
  return { contestIds: demoContestIds, submissionCount: await prisma.submission.count({ where: { sourceId: { startsWith: 'demo-contest:' }, cases: { not: null } } }) }
}

schoolContestRouter.post('/:schoolId/contests/demo-data', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  if (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production') return res.status(404).json({ success: false, message: '接口不存在' })
  const { schoolId } = req.params
  if (req.body.confirmation !== '生成比赛演示数据') return res.status(400).json({ success: false, message: '请提供明确确认' })
  if (!await isSchoolContestAdmin(req.user!.userId, schoolId)) return res.status(403).json({ success: false, message: '只有本校比赛管理员可以生成演示数据' })
  const data = await createDemoContestData(schoolId, req.user!.userId)
  res.json({ success: true, data })
}, '生成演示数据失败'))

/**
 * GET /api/schools/:schoolId/contests
 * 获取校级比赛列表
 */
schoolContestRouter.get('/:schoolId/contests', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const { schoolId } = req.params
  const userId = req.user!.userId
  const typeFilter = req.query.type as string | undefined

  if (!await isSchoolMember(userId, schoolId)) {
    return res.status(403).json({ success: false, message: '无权限查看该校级比赛' })
  }

  const trainings = await prisma.training.findMany({
    where: { schoolId, scope: 'campus', ...(typeFilter ? { type: typeFilter } : { type: 'contest' }) },
    include: {
      _count: { select: { TrainingProblem: true } },
      TrainingProblem: { select: { id: true } },
    },
    orderBy: { startTime: 'desc' },
  })

  const trainingIds = trainings.map(t => t.id)
  const participantCounts = new Map<number, number>()
  if (trainingIds.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ trainingId: number; count: bigint }>>`
      SELECT "trainingId", COUNT(DISTINCT "userId")::int as count
      FROM "Submission"
      WHERE "trainingId" IN (${Prisma.join(trainingIds)})
        AND "submitScope" IN ('training', 'contest')
        AND "workspaceScope" = 'campus'
      GROUP BY "trainingId"
    `
    for (const row of rows) {
      participantCounts.set(Number(row.trainingId), Number(row.count))
    }
  }

  const now = new Date()
  const data = trainings.map(t => {
    const computedStatus = getComputedTrainingStatus(t, now)
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      format: t.format,
      startTime: t.startTime.toISOString(),
      endTime: t.endTime.toISOString(),
      status: computedStatus,
      createdBy: t.createdBy,
      type: t.type,
      problemCount: t._count.TrainingProblem,
      participantCount: participantCounts.get(t.id) || 0,
      createdAt: t.createdAt.toISOString(),
    }
  })

  res.json({
    success: true,
    data: sortTrainingListForDisplay(data),
  })
}, '查询失败'))

/**
 * POST /api/schools/:schoolId/contests
 * 创建校级比赛
 */
schoolContestRouter.post('/:schoolId/contests', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const { schoolId } = req.params
  const userId = req.user!.userId
  const { title, description, format, startTime, endTime, problemIdVisible, solutionVisible, includeAdminInRanking } = req.body

  if (!await isSchoolContestAdmin(userId, schoolId)) {
    return res.status(403).json({ success: false, message: '只有学校负责人或本校教师可以创建校级比赛' })
  }

  if (!title || !startTime || !endTime) {
    return res.status(400).json({ success: false, message: '标题、开始时间、结束时间为必填' })
  }

  if (new Date(endTime) <= new Date(startTime)) {
    return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' })
  }

  if (new Date(startTime) <= new Date()) {
    return res.status(400).json({ success: false, message: '开始时间不能早于当前时间' })
  }

  const training = await prisma.training.create({
    data: {
      schoolId,
      teamId: null,
      scope: 'campus',
      title,
      description: description || null,
      format: format || 'ioi',
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      status: 'upcoming',
      createdBy: userId,
      problemIdVisible: problemIdVisible ?? false,
      solutionVisible: solutionVisible ?? false,
      includeAdminInRanking: includeAdminInRanking ?? false,
      type: 'contest',
      updatedAt: new Date(),
    },
  })

  logger.info('school_contest_created', { action: 'school_contests', metadata: { trainingId: training.id, schoolId } })
  res.json({ success: true, data: training })
}, '创建失败'))

/**
 * PUT /api/schools/:schoolId/contests/:id
 * 更新校级比赛
 */
schoolContestRouter.put('/:schoolId/contests/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const { schoolId } = req.params
  const id = parseTrainingId(req.params.id)
  const userId = req.user!.userId
  const { title, description, format, startTime, endTime, problemIdVisible, solutionVisible, includeAdminInRanking } = req.body

  const training = await prisma.training.findUnique({ where: { id } })
  if (!training) {
    return res.status(404).json({ success: false, message: '比赛不存在' })
  }

  if (training.schoolId !== schoolId) {
    return res.status(403).json({ success: false, message: '该比赛不属于此学校' })
  }

  if (!await isSchoolContestAdmin(userId, schoolId, training.createdBy)) {
    return res.status(403).json({ success: false, message: '只有学校负责人或创建者可以编辑校级比赛' })
  }

  const now = new Date()
  const isStarted = now >= training.startTime

  if (startTime !== undefined && isStarted) {
    return res.status(400).json({ success: false, message: '比赛已经开始，不能修改开始时间' })
  }

  if (!isStarted && startTime && new Date(startTime) <= now) {
    return res.status(400).json({ success: false, message: '开始时间不能早于当前时间' })
  }

  const newStartTime = startTime ? new Date(startTime) : training.startTime
  const newEndTime = endTime ? new Date(endTime) : training.endTime

  if (newEndTime <= newStartTime) {
    return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' })
  }

  if (newEndTime <= now) {
    return res.status(400).json({ success: false, message: '结束时间不能早于当前时间' })
  }

  const updated = await prisma.training.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(format !== undefined && { format }),
      ...(startTime !== undefined && { startTime: newStartTime }),
      ...(endTime !== undefined && { endTime: newEndTime }),
      ...(problemIdVisible !== undefined && { problemIdVisible }),
      ...(solutionVisible !== undefined && { solutionVisible }),
      ...(includeAdminInRanking !== undefined && { includeAdminInRanking }),
    },
  })

  logger.info('school_contest_updated', { action: 'school_contests', metadata: { trainingId: id, schoolId } })
  res.json({ success: true, data: updated })
}, '更新失败'))

/**
 * DELETE /api/schools/:schoolId/contests/:id
 * 删除校级比赛
 */
schoolContestRouter.delete('/:schoolId/contests/:id', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  const { schoolId } = req.params
  const id = parseTrainingId(req.params.id)
  const userId = req.user!.userId

  const training = await prisma.training.findUnique({ where: { id } })
  if (!training) {
    return res.status(404).json({ success: false, message: '比赛不存在' })
  }

  if (training.schoolId !== schoolId) {
    return res.status(403).json({ success: false, message: '该比赛不属于此学校' })
  }

  if (!await isSchoolContestAdmin(userId, schoolId, training.createdBy)) {
    return res.status(403).json({ success: false, message: '只有学校负责人或创建者可以删除校级比赛' })
  }

  await prisma.training.delete({ where: { id } })

  logger.info('school_contest_deleted', { action: 'school_contests', metadata: { trainingId: id, schoolId } })
  res.json({ success: true, message: '删除成功' })
}, '删除失败'))
