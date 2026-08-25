import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { authenticate } from '../../middleware/auth'
import { prisma } from '../../prisma'
import { canManageTraining, parseTrainingId } from './training.helpers'

export const trainingHackSyncRouter = Router()

async function loadContext(trainingId: number, trainingProblemId: string) {
  return prisma.trainingProblem.findFirst({
    where: { id: trainingProblemId, trainingId },
    include: {
      Training: true,
      Problem: { select: { id: true, title: true, judgeConfig: true, testGraphRevision: true } },
    },
  })
}

trainingHackSyncRouter.get('/trainings/:id/problems/:trainingProblemId/hack-sync-preview', authenticate, asyncHandler(async (req, res) => {
  const trainingId = parseTrainingId(req.params.id)
  const item = await loadContext(trainingId, req.params.trainingProblemId)
  if (!item) return res.status(404).json({ success: false, message: '活动题目不存在' })
  if (!await canManageTraining(req.user!.userId, item.Training)) {
    return res.status(403).json({ success: false, message: '无活动管理权限' })
  }
  const currentRevision = item.testGraphRevisionSnapshot ?? 0
  const latestRevision = item.Problem.testGraphRevision
  res.json({
    success: true,
    data: {
      trainingProblemId: item.id,
      problemId: item.problemId,
      problemTitle: item.Problem.title,
      currentRevision,
      latestRevision,
      pending: latestRevision > currentRevision,
      revisionDelta: Math.max(0, latestRevision - currentRevision),
      message: latestRevision > currentRevision ? '有新的 Hack 测试数据待同步' : '当前已是最新测试图',
    },
  })
}))

trainingHackSyncRouter.post('/trainings/:id/problems/:trainingProblemId/hack-sync', authenticate, asyncHandler(async (req, res) => {
  const trainingId = parseTrainingId(req.params.id)
  const item = await loadContext(trainingId, req.params.trainingProblemId)
  if (!item) return res.status(404).json({ success: false, message: '活动题目不存在' })
  if (!await canManageTraining(req.user!.userId, item.Training)) {
    return res.status(403).json({ success: false, message: '无活动管理权限' })
  }
  const currentRevision = item.testGraphRevisionSnapshot ?? 0
  const latestRevision = item.Problem.testGraphRevision
  if (latestRevision <= currentRevision) {
    return res.json({ success: true, data: { updated: false, currentRevision, latestRevision }, message: '当前已是最新测试图' })
  }
  await prisma.trainingProblem.update({
    where: { id: item.id },
    data: {
      judgeConfigSnapshot: item.Problem.judgeConfig,
      testGraphRevisionSnapshot: latestRevision,
      snapshotCreatedAt: new Date(),
    },
  })
  res.json({
    success: true,
    data: { updated: true, previousRevision: currentRevision, currentRevision: latestRevision },
    message: 'Hack 测试数据已同步；历史提交不会自动重测',
  })
}))
