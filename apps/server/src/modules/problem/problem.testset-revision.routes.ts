import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
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
  res.json({ success: true, data: await listTestSetRevisions(problem.id) })
}))

problemTestSetRevisionRouter.get('/:id/test-set-revisions/:revisionId', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const revision = await getProblemTestSetRevision(problem.id, req.params.revisionId)
  if (!revision) return res.status(404).json({ success: false, message: '测试版本不存在' })
  res.json({ success: true, data: revision })
}))

problemTestSetRevisionRouter.post('/:id/judge-mode-transition', authenticate, asyncHandler(async (req, res) => {
  const problem = await findManageableProblem(req.user!, req.params.id)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const targetMode = req.body?.targetMode
  const expectedLatestRevisionId = typeof req.body?.expectedLatestRevisionId === 'string' ? req.body.expectedLatestRevisionId : ''
  if (!['acm', 'oi'].includes(targetMode) || !expectedLatestRevisionId) {
    return res.status(400).json({ success: false, message: '请提供目标模式和当前正式版本' })
  }
  try {
    const revision = await transitionJudgeMode({
      problemId: problem.id, targetMode, expectedLatestRevisionId, updatedBy: req.user!.userId,
    })
    res.json({ success: true, data: revision, message: `已切换为 ${String(targetMode).toUpperCase()}，Hack 已关闭并需要重新确认` })
  } catch (error: any) {
    if (error instanceof TestSetRevisionConflict || error?.code === 'TEST_SET_REVISION_STALE') {
      return res.status(409).json({ success: false, code: 'TEST_SET_REVISION_STALE', message: error.message })
    }
    return res.status(422).json({ success: false, code: 'JUDGE_MODE_TRANSITION_FAILED', message: error.message })
  }
}))
