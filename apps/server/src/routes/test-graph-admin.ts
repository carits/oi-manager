import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { asyncHandler } from '../lib/asyncHandler'
import { inspectAllOiGraphs, migrateLegacyTestGraph, refreshProblemJudgeProjection } from '../modules/problem/problem.test-graph.service'

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
  for (const item of inspection.valid) {
    if (item.alreadyMigrated) { skippedCount++; continue }
    const result = await migrateLegacyTestGraph(item.problemId)
    if (result.ok) {
      await refreshProblemJudgeProjection(item.problemId)
      migratedCount++
    }
  }
  res.json({ success: true, data: { migratedCount, skippedCount, invalidCount: inspection.invalidCount, invalid: inspection.invalid }, message: `已迁移 ${migratedCount} 道 OI 题，跳过 ${skippedCount} 道已迁移题` })
}))
