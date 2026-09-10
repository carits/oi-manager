import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import {
  acceptSolutionContribution,
  createCorrectionContribution,
  createSolutionContribution,
  getProblemSolution,
  getSolutionContribution,
  getSolutionSimilarityComparison,
  listMySolutionContributions,
  listProblemSolutions,
  listSolutionReviewQueue,
  publishSolutionContribution,
  recordSolutionReview,
  refreshSolutionVerification,
  retrySolutionSimilarity,
  SolutionDomainError,
  submitSolutionContribution,
  updateSolutionContribution,
} from './solution.service'

export const problemSolutionRouter = Router()
export const solutionContributionRouter = Router()
export const solutionRouter = Router()
export const solutionReviewRouter = Router()

function command(handler: (req: any) => Promise<unknown>, successStatus = 200) {
  return asyncHandler(async (req: any, res: any) => {
    try {
      const data = await handler(req)
      return res.status(successStatus).json({ success: true, data })
    } catch (error) {
      if (error instanceof SolutionDomainError) {
        return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
      }
      throw error
    }
  })
}

problemSolutionRouter.post('/:problemId/solution-contributions', authenticate, command(
  req => createSolutionContribution(req.user, req.params.problemId, req.body), 201,
))
problemSolutionRouter.get('/:problemId/solution-contributions/me', authenticate, command(
  req => listMySolutionContributions(req.user, req.params.problemId),
))
problemSolutionRouter.get('/:problemId/solutions', authenticate, command(
  req => listProblemSolutions(req.user, req.params.problemId),
))

solutionContributionRouter.get('/:id', authenticate, command(
  req => getSolutionContribution(req.user, req.params.id),
))
solutionContributionRouter.patch('/:id', authenticate, command(
  req => updateSolutionContribution(req.user, req.params.id, req.body),
))
solutionContributionRouter.post('/:id/submit', authenticate, command(
  req => submitSolutionContribution(req.user, req.params.id, false),
))
solutionContributionRouter.post('/:id/resubmit', authenticate, command(
  req => submitSolutionContribution(req.user, req.params.id, true),
))
solutionContributionRouter.post('/:id/verification/refresh', authenticate, command(
  req => refreshSolutionVerification(req.user, req.params.id),
))

solutionRouter.get('/:solutionId', authenticate, command(
  req => getProblemSolution(req.user, req.params.solutionId),
))
solutionRouter.get('/:solutionId/versions/:versionId', authenticate, command(
  req => getProblemSolution(req.user, req.params.solutionId, req.params.versionId),
))
solutionRouter.post('/:solutionId/corrections', authenticate, command(
  req => createCorrectionContribution(req.user, req.params.solutionId, req.body), 201,
))

solutionReviewRouter.get('/', authenticate, command(
  req => listSolutionReviewQueue(req.user, String(req.query.status || '')),
))
solutionReviewRouter.get('/:id/similarity-comparison', authenticate, command(
  req => getSolutionSimilarityComparison(req.user, req.params.id),
))
solutionReviewRouter.post('/:id/reviews', authenticate, command(
  req => recordSolutionReview(req.user, req.params.id, req.body), 201,
))
solutionReviewRouter.post('/:id/request-revision', authenticate, command(
  req => recordSolutionReview(req.user, req.params.id, { ...req.body, decision: 'REQUEST_CHANGES' }), 201,
))
solutionReviewRouter.post('/:id/reject', authenticate, command(
  req => recordSolutionReview(req.user, req.params.id, { ...req.body, decision: 'REJECT' }), 201,
))
solutionReviewRouter.post('/:id/accept', authenticate, command(
  req => acceptSolutionContribution(req.user, req.params.id),
))
solutionReviewRouter.post('/:id/publish', authenticate, command(
  req => publishSolutionContribution(req.user, req.params.id, req.body), 201,
))
solutionReviewRouter.post('/:id/similarity/retry', authenticate, command(
  req => retrySolutionSimilarity(req.user, req.params.id),
))
solutionReviewRouter.get('/:id/similarity-comparison', authenticate, command(
  req => getSolutionSimilarityComparison(req.user, req.params.id),
))
