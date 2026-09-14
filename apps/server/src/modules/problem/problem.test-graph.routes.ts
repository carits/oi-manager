import { Router } from 'express'
import { ProblemContracts } from '@oi-manager/contracts'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
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
  sendContractData(res, ProblemContracts.getTestGraph, await getTestGraphWorkspace(problem.id))
}))

problemTestGraphRouter.post('/:id/test-graph/migrate', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  try {
    parseContractBody(ProblemContracts.migrateTestGraph, req.body ?? {})
  } catch (error) {
    if (sendContractError(error, res)) return
    throw error
  }
  const result = await migrateProblemTestGraph(problem.id, req.user!.userId)
  if (!result.ok) {
    return res.status(422).json({
      success: false, code: result.code, message: result.issues.join('；'), data: { issues: result.issues },
    })
  }
  sendContractData(res, ProblemContracts.migrateTestGraph, result.workspace)
}))

problemTestGraphRouter.post('/:id/test-graph/testcases', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  let body
  try {
    body = parseContractBody(ProblemContracts.registerTestGraphTestcases, req.body)
  } catch (error) {
    if (sendContractError(error, res)) return
    throw error
  }
  const result = await registerProblemTestcases(problem.id, body.pairs)
  if (!result.ok) {
    return res.status(422).json({
      success: false, code: result.code, message: result.issues.join('；'), data: result,
    })
  }
  sendContractData(res, ProblemContracts.registerTestGraphTestcases, result.workspace)
}))

problemTestGraphRouter.patch('/:id/test-graph/testcases/:testcaseId/protection', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  let body
  try {
    body = parseContractBody(ProblemContracts.setTestcaseProtection, req.body)
  } catch (error) {
    if (sendContractError(error, res)) return
    throw error
  }
  const result = await setProblemTestcaseProtection({ problemId: problem.id, testcaseId: req.params.testcaseId, ...body, userId: req.user!.userId })
  if (!result.ok) return res.status(result.code === 'TESTCASE_NOT_FOUND' ? 404 : 422).json({ success: false, code: result.code, message: result.issues.join('；') })
  sendContractData(res, ProblemContracts.setTestcaseProtection, result.testcase)
}))

problemTestGraphRouter.put('/:id/test-graph', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  let body
  try {
    body = parseContractBody(ProblemContracts.saveTestGraph, req.body)
  } catch (error) {
    if (sendContractError(error, res)) return
    throw error
  }
  const result = await saveProblemTestGraph(problem.id, body, req.user!.userId)
  if (!result.ok) {
    return res.status(result.code === 'TEST_GRAPH_STALE' ? 409 : 422).json({
      success: false, code: result.code, message: result.issues?.join('；'), data: result,
    })
  }
  sendContractData(res, ProblemContracts.saveTestGraph, result.graph)
}))
