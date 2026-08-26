import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { authenticate } from '../../middleware/auth'
import { prisma } from '../../prisma'
import { canModifyProblem } from './problem.access'
import {
  TestSetRevisionConflict,
  listTestSetRevisions,
  loadRevisionSpec,
  transitionJudgeMode,
} from './problem.testset-revision.service'

export const problemTestSetRevisionRouter = Router()

async function manageableProblem(id: string, user: any) {
  const problem = await prisma.problem.findUnique({ where: { id } })
  return problem && canModifyProblem(user, problem) ? problem : null
}

problemTestSetRevisionRouter.get('/:id/test-set-revisions', authenticate, asyncHandler(async (req, res) => {
  const problem = await manageableProblem(req.params.id, req.user!)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  res.json({ success: true, data: await listTestSetRevisions(problem.id) })
}))

problemTestSetRevisionRouter.get('/:id/test-set-revisions/:revisionId', authenticate, asyncHandler(async (req, res) => {
  const problem = await manageableProblem(req.params.id, req.user!)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const revision = await prisma.problemTestSetRevision.findFirst({ where: { id: req.params.revisionId, problemId: problem.id } })
  if (!revision) return res.status(404).json({ success: false, message: '测试版本不存在' })
  res.json({ success: true, data: { ...revision, spec: await loadRevisionSpec(revision.id) } })
}))

problemTestSetRevisionRouter.post('/:id/judge-mode-transition', authenticate, asyncHandler(async (req, res) => {
  const problem = await manageableProblem(req.params.id, req.user!)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const targetMode = req.body?.targetMode
  const expectedLatestRevisionId = typeof req.body?.expectedLatestRevisionId === 'string' ? req.body.expectedLatestRevisionId : ''
  if (!['acm', 'oi'].includes(targetMode) || !expectedLatestRevisionId) {
    return res.status(400).json({ success: false, message: '请提供目标模式和当前正式版本' })
  }
  try {
    const revision = await transitionJudgeMode({
      problemId: problem.id,
      targetMode,
      expectedLatestRevisionId,
      updatedBy: req.user!.userId,
    })
    res.json({ success: true, data: revision, message: `已切换为 ${String(targetMode).toUpperCase()}，Hack 已关闭并需要重新确认` })
  } catch (error: any) {
    if (error instanceof TestSetRevisionConflict || error?.code === 'TEST_SET_REVISION_STALE') {
      return res.status(409).json({ success: false, code: 'TEST_SET_REVISION_STALE', message: error.message })
    }
    return res.status(422).json({ success: false, code: 'JUDGE_MODE_TRANSITION_FAILED', message: error.message })
  }
}))
