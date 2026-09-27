import { Router } from 'express'
import { ProblemContracts } from '@oi-manager/contracts'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
import { authenticate } from '../../middleware/auth'
import { TestSetSlotFenceConflict, captureEvolvingForPromotion, getTestSetSlotState, listTestSetPromotionJobs, promoteCapturedEvolvingFromQuality, transitionJudgeMode } from './problem.testset-slot.service'
import { findManageableProblem } from './application/problem-route.service'

export const problemTestSetSlotRouter = Router()

problemTestSetSlotRouter.get('/:id/test-set-slots', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  sendContractData(res, ProblemContracts.listTestSetSlots, {
    slots: await getTestSetSlotState(problem.id),
  })
}))

problemTestSetSlotRouter.get('/:id/test-set-promotion-jobs', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  sendContractData(res, ProblemContracts.listTestSetPromotionJobs, { jobs: await listTestSetPromotionJobs(problem.id) })
}))

problemTestSetSlotRouter.post('/:id/test-set-promotion-jobs', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  parseContractBody(ProblemContracts.captureTestSetPromotion, req.body)
  const captured = await captureEvolvingForPromotion({ problemId: problem.id, requestedBy: req.user!.userId })
  sendContractData(res, ProblemContracts.captureTestSetPromotion, { jobId: captured.jobId, graphHash: captured.graphHash, fencingToken: captured.fencingToken }, 201)
}))

problemTestSetSlotRouter.post('/:id/test-set-promotion-jobs/:jobId/complete', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  try {
    const { qualitySnapshotId } = parseContractBody(ProblemContracts.completeTestSetPromotion, req.body)
    const writer = await promoteCapturedEvolvingFromQuality({ jobId: req.params.jobId, qualitySnapshotId, requestedBy: req.user!.userId })
    sendContractData(res, ProblemContracts.completeTestSetPromotion, writer)
  } catch (error: any) {
    if (sendContractError(error, res)) return
    return res.status(422).json({ success: false, code: 'TEST_SET_PROMOTION_REJECTED', message: error.message })
  }
}))

problemTestSetSlotRouter.post('/:id/judge-mode-transition', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  try {
    const { targetMode, slot, expectedFencingToken } = parseContractBody(ProblemContracts.transitionJudgeMode, req.body)
    const writer = await transitionJudgeMode({
      problemId: problem.id, targetMode, slot, expectedFencingToken, updatedBy: req.user!.userId,
    })
    sendContractData(res, ProblemContracts.transitionJudgeMode, writer)
  } catch (error: any) {
    if (sendContractError(error, res)) return
    if (error instanceof TestSetSlotFenceConflict || error?.code === 'TEST_SET_SLOT_FENCE_CONFLICT') {
      return res.status(409).json({ success: false, code: 'TEST_SET_SLOT_FENCE_CONFLICT', message: error.message })
    }
    return res.status(422).json({ success: false, code: 'JUDGE_MODE_TRANSITION_FAILED', message: error.message })
  }
}))
