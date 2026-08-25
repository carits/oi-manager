import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { prisma } from '../../prisma'
import { canModifyProblem } from './problem.access'
import { inspectLegacyTestGraph, loadTestGraph, replaceTestGraph } from './problem.test-graph.service'

export const problemTestGraphRouter = Router()

problemTestGraphRouter.get('/:id/test-graph', authenticate, asyncHandler(async (req, res) => {
  const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!problem || !canModifyProblem(req.user!, problem)) return res.status(404).json({ success: false, message: '题目不存在' })
  const [graph, inspection] = await Promise.all([loadTestGraph(problem.id), inspectLegacyTestGraph(problem.id)])
  res.json({ success: true, data: { ...graph, migrationIssues: inspection.issues, canMigrate: inspection.ok && !inspection.alreadyMigrated } })
}))

problemTestGraphRouter.put('/:id/test-graph', authenticate, asyncHandler(async (req, res) => {
  const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
  if (!problem || !canModifyProblem(req.user!, problem)) return res.status(404).json({ success: false, message: '题目不存在' })
  const result = await replaceTestGraph(problem.id, req.body)
  if (!result.ok) return res.status(422).json({ success: false, code: 'INVALID_TEST_GRAPH', message: result.issues?.join('；'), data: result })
  res.json({ success: true, data: result.graph, message: '测试图已保存' })
}))
