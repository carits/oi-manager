import { Router, type Response } from 'express'
import { ContestRatingContracts, RatingAccountContracts, RatingLeaderboardContracts } from '@oi-manager/contracts'
import { authenticate, isPersonalContext, type AuthRequest } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseTrainingId } from '../contest/contest.helpers'
import { trainingMatchesWorkspaceScope } from '../contest/application/contest-scope.service'
import { ContestRatingError, finalizeContestRating, getContestRating, getContestRatingConfig, getRatingParticipation, rebuildContestRating, setFinalSubmission, updateContestRatingConfig, updateRatingParticipantDisposition, updateRatingParticipation } from './application/contest-rating.service'
import { getMyRatingAccounts, getRatingHistory, getRatingLeaderboard } from './application/rating-query.service'
import { parseContractQuery, sendContractData, sendContractError } from '../../lib/api-contract'

export const ratingDomainRouter = Router()

function endpoint(handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try { await handler(req, res) } catch (error) {
      if (sendContractError(error, res)) return
      if (error instanceof ContestRatingError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
      throw error
    }
  })
}

ratingDomainRouter.get('/ratings/me', authenticate, endpoint(async (req, res) => sendContractData(res, RatingAccountContracts.mine, await getMyRatingAccounts(req.user!.userId))))
ratingDomainRouter.get('/ratings/global/:track', authenticate, endpoint(async (req, res) => {
  const query = parseContractQuery(RatingLeaderboardContracts.global, req.query)
  sendContractData(res, RatingLeaderboardContracts.global, await getRatingLeaderboard({ scope: 'GLOBAL', track: req.params.track, query, requestingUserId: req.user!.userId }))
}))
ratingDomainRouter.get('/ratings/organizations/:organizationId/:track', authenticate, endpoint(async (req, res) => {
  if (isPersonalContext(req.user!) || req.user!.organizationId !== req.params.organizationId) {
    return res.status(403).json({ success: false, code: 'ORGANIZATION_RATING_ACCESS_DENIED', message: '当前组织上下文无效' })
  }
  const query = parseContractQuery(RatingLeaderboardContracts.organization, req.query)
  return sendContractData(res, RatingLeaderboardContracts.organization, await getRatingLeaderboard({ scope: 'ORGANIZATION', organizationId: req.params.organizationId, track: req.params.track, query, requestingUserId: req.user!.userId }))
}))
ratingDomainRouter.get('/ratings/users/:userId/history', authenticate, endpoint(async (req, res) => {
  const query = parseContractQuery(RatingAccountContracts.history, req.query)
  sendContractData(res, RatingAccountContracts.history, await getRatingHistory({ userId: req.params.userId, requestingUserId: req.user!.userId, scope: query.scope, organizationId: query.organizationId, track: query.track, query }))
}))

ratingDomainRouter.use('/contests/:id', authenticate, asyncHandler(async (req: AuthRequest, res, next) => {
  const trainingId = parseTrainingId(req.params.id)
  if (!await trainingMatchesWorkspaceScope(trainingId, req.user!)) {
    return res.status(404).json({ success: false, code: 'CONTEST_NOT_FOUND', message: '比赛不存在' })
  }
  next()
}))

ratingDomainRouter.get('/contests/:id/rating-config', endpoint(async (req, res) => res.json({ success: true, data: await getContestRatingConfig(parseTrainingId(req.params.id), req.user!.userId) })))
ratingDomainRouter.put('/contests/:id/rating-config', endpoint(async (req, res) => res.json({ success: true, data: await updateContestRatingConfig(parseTrainingId(req.params.id), req.user!.userId, req.body) })))
ratingDomainRouter.get('/contests/:id/rating-participation', endpoint(async (req, res) => res.json({ success: true, data: await getRatingParticipation(parseTrainingId(req.params.id), req.user!.userId) })))
ratingDomainRouter.put('/contests/:id/rating-participation', endpoint(async (req, res) => res.json({ success: true, data: await updateRatingParticipation(parseTrainingId(req.params.id), req.user!.userId, req.body) })))
ratingDomainRouter.get('/contests/:id/rating', endpoint(async (req, res) => sendContractData(res, ContestRatingContracts.detail, await getContestRating(parseTrainingId(req.params.id), req.user!.userId))))
ratingDomainRouter.post('/contests/:id/finalize', endpoint(async (req, res) => res.json({ success: true, data: await finalizeContestRating(parseTrainingId(req.params.id), req.user!.userId) })))
ratingDomainRouter.post('/contests/:id/rating/rebuild', endpoint(async (req, res) => res.json({ success: true, data: await rebuildContestRating(parseTrainingId(req.params.id), req.user!.userId) })))
ratingDomainRouter.post('/contests/:id/problems/:trainingProblemId/final-submission/:submissionId', endpoint(async (req, res) => res.json({ success: true, data: await setFinalSubmission(parseTrainingId(req.params.id), req.params.trainingProblemId, Number(req.params.submissionId), req.user!.userId) })))

ratingDomainRouter.patch('/contests/:id/rating-participants/:userId', endpoint(async (req, res) => {
  res.json({ success: true, data: await updateRatingParticipantDisposition(parseTrainingId(req.params.id), req.params.userId, req.user!.userId, req.body) })
}))
