import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { inspectAllOiGraphs, migrateLegacyTestGraph, refreshProblemJudgeProjection } from '../modules/problem/problem.test-graph.service'
import { prisma } from '../prisma'

export const testGraphAdminRouter = Router()

testGraphAdminRouter.get('/problem-test-graph/migration', authenticate, asyncHandler(async (req, res) => {
  if (req.user?.role !== 'super_admin') return res.status(403).json({ success: false, message: '仅超级管理员可执行测试图迁移' })
  res.json({ success: true, data: await inspectAllOiGraphs() })
}))

testGraphAdminRouter.post('/problem-test-graph/migration', authenticate, asyncHandler(async (req, res) => {
  if (req.user?.role !== 'super_admin') return res.status(403).json({ success: false, message: '仅超级管理员可执行测试图迁移' })
  if (req.body?.action !== 'apply') return res.status(400).json({ success: false, message: 'action 必须为 apply' })
  const inspection = await inspectAllOiGraphs()
  let migratedCount = 0
  let skippedCount = 0
  let backfilledSnapshotCount = 0
  for (const item of inspection.valid) {
    if (item.alreadyMigrated) {
      skippedCount++
      const problem = await prisma.problem.findUnique({ where: { id: item.problemId }, select: { testGraphRevision: true } })
      if (problem?.testGraphRevision) {
        const backfilled = await prisma.trainingProblem.updateMany({
          where: { problemId: item.problemId, testGraphRevisionSnapshot: null },
          data: { testGraphRevisionSnapshot: problem.testGraphRevision },
        })
        backfilledSnapshotCount += backfilled.count
      }
      continue
    }
    const result = await migrateLegacyTestGraph(item.problemId)
    if (result.ok) {
      await refreshProblemJudgeProjection(item.problemId)
      const backfilled = await prisma.trainingProblem.updateMany({
        where: { problemId: item.problemId, testGraphRevisionSnapshot: null },
        data: { testGraphRevisionSnapshot: 1 },
      })
      backfilledSnapshotCount += backfilled.count
      migratedCount++
    }
  }
  res.json({ success: true, data: { migratedCount, skippedCount, backfilledSnapshotCount, invalidCount: inspection.invalidCount, invalid: inspection.invalid }, message: `已迁移 ${migratedCount} 道 OI 题，跳过 ${skippedCount} 道已迁移题，回填 ${backfilledSnapshotCount} 个等价活动快照 revision` })
}))
