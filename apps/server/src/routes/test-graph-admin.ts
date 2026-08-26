import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { inspectAllOiGraphs, migrateLegacyTestGraph, refreshProblemJudgeProjection } from '../modules/problem/problem.test-graph.service'
import { prisma } from '../prisma'
import { inspectTestSetRevisionMigration, migrateProblemTestSetRevisions } from '../modules/problem/problem.testset-revision.service'

export const testGraphAdminRouter = Router()

testGraphAdminRouter.get('/problem-test-set-revisions/migration', authenticate, asyncHandler(async (req, res) => {
  if (req.user?.role !== 'super_admin') return res.status(403).json({ success: false, message: '仅超级管理员可执行测试版本迁移' })
  res.json({ success: true, data: await inspectTestSetRevisionMigration() })
}))

testGraphAdminRouter.post('/problem-test-set-revisions/migration', authenticate, asyncHandler(async (req, res) => {
  if (req.user?.role !== 'super_admin') return res.status(403).json({ success: false, message: '仅超级管理员可执行测试版本迁移' })
  if (req.body?.action !== 'apply') return res.status(400).json({ success: false, message: 'action 必须为 apply' })
  const inspection = await inspectTestSetRevisionMigration()
  const results = []
  for (const item of inspection.valid) {
    try { results.push({ problemId: item.problemId, ok: true, ...(await migrateProblemTestSetRevisions(item.problemId, req.user!.userId)) }) }
    catch (error: any) { results.push({ problemId: item.problemId, ok: false, message: error.message }) }
  }
  const succeeded = results.filter(item => item.ok).length
  res.json({
    success: true,
    data: { succeeded, failed: results.length - succeeded, invalid: inspection.invalid, results },
    message: `已完成 ${succeeded} 道题的正式测试版本迁移`,
  })
}))

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
