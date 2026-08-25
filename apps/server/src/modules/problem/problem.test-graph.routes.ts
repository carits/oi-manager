import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { prisma } from '../../prisma'
import { canModifyProblem } from './problem.access'
import {
  inspectLegacyTestGraph,
  loadTestGraphWorkspace,
  migrateLegacyTestGraph,
  refreshProblemJudgeProjection,
  registerOfficialTestcases,
  replaceTestGraph,
} from './problem.test-graph.service'

export const problemTestGraphRouter = Router()

problemTestGraphRouter.get('/:id/test-graph', authenticate, asyncHandler(async (req, res) => {
  const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!problem || !canModifyProblem(req.user!, problem)) return res.status(404).json({ success: false, message: '题目不存在' })
  const [graph, inspection] = await Promise.all([loadTestGraphWorkspace(problem.id), inspectLegacyTestGraph(problem.id)])
  res.json({ success: true, data: { ...graph, migrationIssues: inspection.issues, canMigrate: inspection.ok && !inspection.alreadyMigrated } })
}))

problemTestGraphRouter.post('/:id/test-graph/migrate', authenticate, asyncHandler(async (req, res) => {
  const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!problem || !canModifyProblem(req.user!, problem)) return res.status(404).json({ success: false, message: '题目不存在' })
  const inspection = await inspectLegacyTestGraph(problem.id)
  if (!inspection.ok) return res.status(422).json({ success: false, code: 'TEST_GRAPH_MIGRATION_BLOCKED', message: inspection.issues.join('；'), data: { issues: inspection.issues } })
  if (!inspection.alreadyMigrated) {
    const migrated = await migrateLegacyTestGraph(problem.id)
    if (!migrated.ok) return res.status(422).json({ success: false, code: 'TEST_GRAPH_MIGRATION_BLOCKED', message: migrated.issues.join('；'), data: { issues: migrated.issues } })
    await refreshProblemJudgeProjection(problem.id)
  }
  const current = await prisma.problem.findUnique({ where: { id: problem.id }, select: { testGraphRevision: true } })
  if (current?.testGraphRevision) {
    await prisma.trainingProblem.updateMany({
      where: { problemId: problem.id, testGraphRevisionSnapshot: null },
      data: { testGraphRevisionSnapshot: current.testGraphRevision },
    })
  }
  res.json({ success: true, data: await loadTestGraphWorkspace(problem.id), message: inspection.alreadyMigrated ? '测试图已经迁移' : '测试图迁移完成' })
}))

problemTestGraphRouter.post('/:id/test-graph/testcases', authenticate, asyncHandler(async (req, res) => {
  const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!problem || !canModifyProblem(req.user!, problem)) return res.status(404).json({ success: false, message: '题目不存在' })
  const result = await registerOfficialTestcases(problem.id, Array.isArray(req.body?.pairs) ? req.body.pairs : [])
  if (!result.ok) return res.status(422).json({ success: false, code: result.code, message: result.issues.join('；'), data: result })
  res.json({ success: true, data: await loadTestGraphWorkspace(problem.id), message: `已注册 ${result.registeredCount} 个测试点` })
}))

problemTestGraphRouter.put('/:id/test-graph', authenticate, asyncHandler(async (req, res) => {
  const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!problem || !canModifyProblem(req.user!, problem)) return res.status(404).json({ success: false, message: '题目不存在' })
  const result = await replaceTestGraph(problem.id, req.body)
  if (!result.ok) return res.status(result.code === 'TEST_GRAPH_STALE' ? 409 : 422).json({ success: false, code: result.code, message: result.issues?.join('；'), data: result })
  res.json({ success: true, data: result.graph, message: '测试图已保存' })
}))
