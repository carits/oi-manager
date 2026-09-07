import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import {
  findManageableProblem,
  getTestGraphWorkspace,
  migrateProblemTestGraph,
  registerProblemTestcases,
  saveProblemTestGraph,
} from './application/problem-route.service'
import { setProblemTestcaseProtection } from './problem.test-graph.service'

export const problemTestGraphRouter = Router()

problemTestGraphRouter.get('/:id/test-graph', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  res.json({ success: true, data: await getTestGraphWorkspace(problem.id) })
}))

problemTestGraphRouter.post('/:id/test-graph/migrate', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const result = await migrateProblemTestGraph(problem.id, req.user!.userId)
  if (!result.ok) {
    return res.status(422).json({
      success: false, code: result.code, message: result.issues.join('；'), data: { issues: result.issues },
    })
  }
  res.json({
    success: true,
    data: result.workspace,
    message: result.alreadyMigrated ? '测试图已经迁移' : '测试图迁移完成',
  })
}))

problemTestGraphRouter.post('/:id/test-graph/testcases', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const result = await registerProblemTestcases(problem.id, req.body?.pairs)
  if (!result.ok) {
    return res.status(422).json({
      success: false, code: result.code, message: result.issues.join('；'), data: result,
    })
  }
  res.json({ success: true, data: result.workspace, message: `已注册 ${result.registeredCount} 个测试点` })
}))

problemTestGraphRouter.patch('/:id/test-graph/testcases/:testcaseId/protection', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const result = await setProblemTestcaseProtection({ problemId: problem.id, testcaseId: req.params.testcaseId, isProtected: req.body?.isProtected === true, reason: req.body?.reason, userId: req.user!.userId })
  if (!result.ok) return res.status(result.code === 'TESTCASE_NOT_FOUND' ? 404 : 422).json({ success: false, code: result.code, message: result.issues.join('；') })
  res.json({ success: true, data: result.testcase, message: result.testcase.isProtected ? '测试点已设为永久保护' : '已解除测试点永久保护' })
}))

problemTestGraphRouter.put('/:id/test-graph', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const result = await saveProblemTestGraph(problem.id, req.body, req.user!.userId)
  if (!result.ok) {
    return res.status(result.code === 'TEST_GRAPH_STALE' ? 409 : 422).json({
      success: false, code: result.code, message: result.issues?.join('；'), data: result,
    })
  }
  res.json({ success: true, data: result.graph, message: '测试图已保存' })
}))
