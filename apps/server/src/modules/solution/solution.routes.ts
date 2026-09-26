import { Router, type Response } from 'express'
import {
  SolutionReviewContracts,
  type ApiEndpointContract,
} from '@oi-manager/contracts'
import type { ZodType } from 'zod'
import { authenticate, type AuthRequest } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import {
  parseContractBody,
  parseContractQuery,
  sendContractData,
  sendContractError,
} from '../../lib/api-contract'
import type { JwtPayload } from '@oi-manager/shared'
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

type AuthenticatedRequest = AuthRequest & { user: JwtPayload }
type Contract = ApiEndpointContract<ZodType, ZodType, ZodType>

function command(
  contract: Contract,
  handler: (req: AuthenticatedRequest) => Promise<unknown>,
  successStatus = 200,
) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      return sendContractData(
        res,
        contract,
        await handler(req as AuthenticatedRequest),
        successStatus,
      )
    } catch (error) {
      if (sendContractError(error, res)) return
      if (error instanceof SolutionDomainError) {
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          message: error.message,
        })
      }
      throw error
    }
  })
}

problemSolutionRouter.post('/:problemId/solution-contributions', authenticate, command(
  SolutionReviewContracts.createContribution,
  req => createSolutionContribution(
    req.user,
    req.params.problemId,
    parseContractBody(SolutionReviewContracts.createContribution, req.body),
  ),
  201,
))
problemSolutionRouter.get('/:problemId/solution-contributions/me', authenticate, command(
  SolutionReviewContracts.listMyContributions,
  req => listMySolutionContributions(req.user, req.params.problemId),
))
problemSolutionRouter.get('/:problemId/solutions', authenticate, command(
  SolutionReviewContracts.listProblemSolutions,
  req => listProblemSolutions(req.user, req.params.problemId),
))

solutionContributionRouter.get('/:id', authenticate, command(
  SolutionReviewContracts.getContribution,
  req => getSolutionContribution(req.user, req.params.id),
))
solutionContributionRouter.patch('/:id', authenticate, command(
  SolutionReviewContracts.updateContribution,
  req => updateSolutionContribution(
    req.user,
    req.params.id,
    parseContractBody(SolutionReviewContracts.updateContribution, req.body),
  ),
))
solutionContributionRouter.post('/:id/submit', authenticate, command(
  SolutionReviewContracts.submitContribution,
  req => {
    parseContractBody(SolutionReviewContracts.submitContribution, req.body)
    return submitSolutionContribution(req.user, req.params.id, false)
  },
))
solutionContributionRouter.post('/:id/resubmit', authenticate, command(
  SolutionReviewContracts.resubmitContribution,
  req => {
    parseContractBody(SolutionReviewContracts.resubmitContribution, req.body)
    return submitSolutionContribution(req.user, req.params.id, true)
  },
))
solutionContributionRouter.post('/:id/verification/refresh', authenticate, command(
  SolutionReviewContracts.refreshVerification,
  req => {
    parseContractBody(SolutionReviewContracts.refreshVerification, req.body)
    return refreshSolutionVerification(req.user, req.params.id)
  },
))

solutionRouter.get('/:solutionId', authenticate, command(
  SolutionReviewContracts.getSolution,
  req => getProblemSolution(req.user, req.params.solutionId),
))
solutionRouter.get('/:solutionId/versions/:versionId', authenticate, command(
  SolutionReviewContracts.getSolutionVersion,
  req => getProblemSolution(req.user, req.params.solutionId, req.params.versionId),
))
solutionRouter.post('/:solutionId/corrections', authenticate, command(
  SolutionReviewContracts.createCorrection,
  req => createCorrectionContribution(
    req.user,
    req.params.solutionId,
    parseContractBody(SolutionReviewContracts.createCorrection, req.body),
  ),
  201,
))

solutionReviewRouter.get('/', authenticate, command(
  SolutionReviewContracts.reviewQueue,
  req => {
    const query = parseContractQuery(SolutionReviewContracts.reviewQueue, req.query)
    return listSolutionReviewQueue(req.user, query.status)
  },
))
solutionReviewRouter.get('/:id/similarity-comparison', authenticate, command(
  SolutionReviewContracts.similarityComparison,
  req => getSolutionSimilarityComparison(req.user, req.params.id),
))
solutionReviewRouter.post('/:id/reviews', authenticate, command(
  SolutionReviewContracts.recordReview,
  req => recordSolutionReview(
    req.user,
    req.params.id,
    parseContractBody(SolutionReviewContracts.recordReview, req.body),
  ),
  201,
))
solutionReviewRouter.post('/:id/request-revision', authenticate, command(
  SolutionReviewContracts.requestRevision,
  req => recordSolutionReview(req.user, req.params.id, {
    ...parseContractBody(SolutionReviewContracts.requestRevision, req.body),
    decision: 'REQUEST_CHANGES',
  }),
  201,
))
solutionReviewRouter.post('/:id/reject', authenticate, command(
  SolutionReviewContracts.rejectContribution,
  req => recordSolutionReview(req.user, req.params.id, {
    ...parseContractBody(SolutionReviewContracts.rejectContribution, req.body),
    decision: 'REJECT',
  }),
  201,
))
solutionReviewRouter.post('/:id/accept', authenticate, command(
  SolutionReviewContracts.acceptContribution,
  req => {
    parseContractBody(SolutionReviewContracts.acceptContribution, req.body)
    return acceptSolutionContribution(req.user, req.params.id)
  },
))
solutionReviewRouter.post('/:id/publish', authenticate, command(
  SolutionReviewContracts.publishContribution,
  req => publishSolutionContribution(
    req.user,
    req.params.id,
    parseContractBody(SolutionReviewContracts.publishContribution, req.body),
  ),
  201,
))
solutionReviewRouter.post('/:id/similarity/retry', authenticate, command(
  SolutionReviewContracts.retrySimilarity,
  req => {
    parseContractBody(SolutionReviewContracts.retrySimilarity, req.body)
    return retrySolutionSimilarity(req.user, req.params.id)
  },
))
