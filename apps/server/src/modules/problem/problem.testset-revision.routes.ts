import { Router } from 'express'
import { ProblemContracts } from '@oi-manager/contracts'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
import { authenticate } from '../../middleware/auth'
import {
  TestSetRevisionConflict,
  listTestSetRevisions,
  transitionJudgeMode,
} from './problem.testset-revision.service'
import {
  findManageableProblem,
  getProblemTestSetRevision,
} from './application/problem-route.service'

export const problemTestSetRevisionRouter = Router()

problemTestSetRevisionRouter.get('/:id/test-set-revisions', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  sendContractData(res, ProblemContracts.listTestSetRevisions, await listTestSetRevisions(problem.id))
}))

problemTestSetRevisionRouter.get('/:id/test-set-revisions/:revisionId', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const revision = await getProblemTestSetRevision(problem.id, req.params.revisionId)
  if (!revision) return res.status(404).json({ success: false, message: '测试版本不存在' })
  sendContractData(res, ProblemContracts.getTestSetRevision, revision)
}))

problemTestSetRevisionRouter.post('/:id/judge-mode-transition', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  try {
    const { targetMode, expectedLatestRevisionId } = parseContractBody(
      ProblemContracts.transitionJudgeMode,
      req.body,
    )
    const revision = await transitionJudgeMode({
      problemId: problem.id, targetMode, expectedLatestRevisionId, updatedBy: req.user!.userId,
    })
    sendContractData(res, ProblemContracts.transitionJudgeMode, revision)
  } catch (error: any) {
    if (sendContractError(error, res)) return
    if (error instanceof TestSetRevisionConflict || error?.code === 'TEST_SET_REVISION_STALE') {
      return res.status(409).json({ success: false, code: 'TEST_SET_REVISION_STALE', message: error.message })
    }
    return res.status(422).json({ success: false, code: 'JUDGE_MODE_TRANSITION_FAILED', message: error.message })
  }
}))
