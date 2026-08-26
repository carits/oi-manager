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
      TestSetRevision: true,
      Problem: { include: { LatestTestSetRevision: true } },
    },
  })
}

async function revisionState(item: NonNullable<Awaited<ReturnType<typeof loadContext>>>) {
  const submissionCount = await prisma.submission.count({ where: { trainingProblemId: item.id } })
  const started = new Date() >= item.Training.startTime
  const frozen = started || submissionCount > 0
  const latest = item.Problem.LatestTestSetRevision
  const current = item.TestSetRevision
  return {
    currentRevisionId: current?.id || null,
    currentRevision: current?.revisionNumber || null,
    latestRevisionId: latest?.id || null,
    latestRevision: latest?.revisionNumber || null,
    pending: Boolean(latest && latest.id !== current?.id),
    frozen,
    frozenReason: started ? '活动已经开始' : submissionCount > 0 ? '活动已经存在提交记录' : null,
    submissionCount,
  }
}

trainingHackSyncRouter.get('/trainings/:id/problems/:trainingProblemId/test-set-update', authenticate, asyncHandler(async (req, res) => {
  const trainingId = parseTrainingId(req.params.id)
  const item = await loadContext(trainingId, req.params.trainingProblemId)
  if (!item) return res.status(404).json({ success: false, message: '活动题目不存在' })
  if (!await canManageTraining(req.user!.userId, item.Training)) return res.status(403).json({ success: false, message: '无活动管理权限' })
  const state = await revisionState(item)
  res.json({
    success: true,
    data: { trainingProblemId: item.id, problemId: item.problemId, problemTitle: item.Problem.title, ...state },
  })
}))

trainingHackSyncRouter.post('/trainings/:id/problems/:trainingProblemId/test-set-update', authenticate, asyncHandler(async (req, res) => {
  const trainingId = parseTrainingId(req.params.id)
  const item = await loadContext(trainingId, req.params.trainingProblemId)
  if (!item) return res.status(404).json({ success: false, message: '活动题目不存在' })
  if (!await canManageTraining(req.user!.userId, item.Training)) return res.status(403).json({ success: false, message: '无活动管理权限' })
  const state = await revisionState(item)
  if (state.frozen) {
    return res.status(409).json({ success: false, code: 'TEST_SET_REVISION_FROZEN', message: `${state.frozenReason}，测试版本已永久冻结`, data: state })
  }
  const revisionId = typeof req.body?.revisionId === 'string' ? req.body.revisionId : item.Problem.latestTestSetRevisionId
  if (!revisionId) return res.status(409).json({ success: false, code: 'TEST_SET_REVISION_REQUIRED', message: '题库尚无正式测试版本' })
  const revision = await prisma.problemTestSetRevision.findFirst({ where: { id: revisionId, problemId: item.problemId } })
  if (!revision) return res.status(404).json({ success: false, message: '测试版本不存在' })
  if (revision.id === item.testSetRevisionId) return res.json({ success: true, data: { updated: false, ...state }, message: '活动已经使用该测试版本' })
  await prisma.trainingProblem.update({
    where: { id: item.id },
    data: {
      testSetRevisionId: revision.id,
      judgeConfigSnapshot: revision.judgeConfig,
      testGraphRevisionSnapshot: revision.revisionNumber,
      snapshotCreatedAt: new Date(),
      dataVersion: '2',
    },
  })
  res.json({
    success: true,
    data: { updated: true, previousRevisionId: item.testSetRevisionId, currentRevisionId: revision.id, currentRevision: revision.revisionNumber },
    message: `活动已固定到测试版本 R${revision.revisionNumber}`,
  })
}))

for (const suffix of ['hack-sync-preview', 'hack-sync']) {
  trainingHackSyncRouter.all(`/trainings/:id/problems/:trainingProblemId/${suffix}`, authenticate, (_req, res) => {
    res.status(410).json({ success: false, code: 'HACK_SYNC_RETIRED', message: '题库 Hack 不再直接同步活动，请使用测试版本更新接口' })
  })
}
