import { Router, type Response } from 'express'
import { ContestRatingContracts, RatingAccountContracts, RatingLeaderboardContracts } from '@oi-manager/contracts'
import { authenticate, type AuthRequest } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseTrainingId } from '../training/training.helpers'
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
  const query = parseContractQuery(RatingLeaderboardContracts.organization, req.query)
  sendContractData(res, RatingLeaderboardContracts.organization, await getRatingLeaderboard({ scope: 'ORGANIZATION', organizationId: req.params.organizationId, track: req.params.track, query, requestingUserId: req.user!.userId }))
}))
ratingDomainRouter.get('/ratings/users/:userId/history', authenticate, endpoint(async (req, res) => {
  const query = parseContractQuery(RatingAccountContracts.history, req.query)
  sendContractData(res, RatingAccountContracts.history, await getRatingHistory({ userId: req.params.userId, requestingUserId: req.user!.userId, scope: query.scope, organizationId: query.organizationId, track: query.track, query }))
}))

ratingDomainRouter.get('/trainings/:id/rating-config', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await getContestRatingConfig(parseTrainingId(req.params.id), req.user!.userId) })))
ratingDomainRouter.put('/trainings/:id/rating-config', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await updateContestRatingConfig(parseTrainingId(req.params.id), req.user!.userId, req.body) })))
ratingDomainRouter.get('/trainings/:id/rating-participation', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await getRatingParticipation(parseTrainingId(req.params.id), req.user!.userId) })))
ratingDomainRouter.put('/trainings/:id/rating-participation', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await updateRatingParticipation(parseTrainingId(req.params.id), req.user!.userId, req.body) })))
ratingDomainRouter.get('/trainings/:id/rating', authenticate, endpoint(async (req, res) => sendContractData(res, ContestRatingContracts.detail, await getContestRating(parseTrainingId(req.params.id), req.user!.userId))))
ratingDomainRouter.post('/trainings/:id/finalize', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await finalizeContestRating(parseTrainingId(req.params.id), req.user!.userId) })))
ratingDomainRouter.post('/trainings/:id/rating/rebuild', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await rebuildContestRating(parseTrainingId(req.params.id), req.user!.userId) })))
ratingDomainRouter.post('/trainings/:id/problems/:trainingProblemId/final-submission/:submissionId', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await setFinalSubmission(parseTrainingId(req.params.id), req.params.trainingProblemId, Number(req.params.submissionId), req.user!.userId) })))

ratingDomainRouter.patch('/trainings/:id/rating-participants/:userId', authenticate, endpoint(async (req, res) => {
  res.json({ success: true, data: await updateRatingParticipantDisposition(parseTrainingId(req.params.id), req.params.userId, req.user!.userId, req.body) })
}))
