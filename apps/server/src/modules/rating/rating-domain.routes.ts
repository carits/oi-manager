import { Router } from 'express'
import { authenticate, type AuthRequest } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { canManageTraining, parseTrainingId } from '../training/training.helpers'
import { prisma } from '../../prisma'
import { ContestRatingError, finalizeContestRating, getContestRating, getContestRatingConfig, rebuildContestRating, setFinalSubmission, updateContestRatingConfig } from './application/contest-rating.service'
import { getMyRatingAccounts, getRatingHistory, getRatingLeaderboard } from './application/rating-query.service'

export const ratingDomainRouter = Router()

function endpoint(handler: (req: AuthRequest, res: any) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res) => {
    try { await handler(req, res) } catch (error) {
      if (error instanceof ContestRatingError) return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
      throw error
    }
  })
}

ratingDomainRouter.get('/ratings/me', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await getMyRatingAccounts(req.user!.userId) })))
ratingDomainRouter.get('/ratings/global/:track', authenticate, endpoint(async (req, res) => res.json({ success: true, ...(await getRatingLeaderboard({ scope: 'GLOBAL', track: req.params.track, query: req.query, requestingUserId: req.user!.userId })) })))
ratingDomainRouter.get('/ratings/organizations/:organizationId/:track', authenticate, endpoint(async (req, res) => res.json({ success: true, ...(await getRatingLeaderboard({ scope: 'ORGANIZATION', organizationId: req.params.organizationId, track: req.params.track, query: req.query, requestingUserId: req.user!.userId })) })))
ratingDomainRouter.get('/ratings/users/:userId/history', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await getRatingHistory({ userId: req.params.userId, requestingUserId: req.user!.userId, scope: String(req.query.scope || 'GLOBAL'), organizationId: typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined, track: req.query.track, query: req.query }) })))

ratingDomainRouter.get('/trainings/:id/rating-config', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await getContestRatingConfig(parseTrainingId(req.params.id), req.user!.userId) })))
ratingDomainRouter.put('/trainings/:id/rating-config', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await updateContestRatingConfig(parseTrainingId(req.params.id), req.user!.userId, req.body) })))
ratingDomainRouter.get('/trainings/:id/rating', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await getContestRating(parseTrainingId(req.params.id), req.user!.userId) })))
ratingDomainRouter.post('/trainings/:id/finalize', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await finalizeContestRating(parseTrainingId(req.params.id), req.user!.userId) })))
ratingDomainRouter.post('/trainings/:id/rating/rebuild', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await rebuildContestRating(parseTrainingId(req.params.id), req.user!.userId) })))
ratingDomainRouter.post('/trainings/:id/problems/:trainingProblemId/final-submission/:submissionId', authenticate, endpoint(async (req, res) => res.json({ success: true, data: await setFinalSubmission(parseTrainingId(req.params.id), req.params.trainingProblemId, Number(req.params.submissionId), req.user!.userId) })))

ratingDomainRouter.patch('/trainings/:id/rating-participants/:userId', authenticate, endpoint(async (req, res) => {
  const trainingId = parseTrainingId(req.params.id)
  const training = await prisma.training.findUnique({ where: { id: trainingId } })
  if (!training || training.type !== 'contest') throw new ContestRatingError(404, 'CONTEST_NOT_FOUND', '比赛不存在')
  if (!await canManageTraining(req.user!.userId, training)) throw new ContestRatingError(403, 'CONTEST_MANAGE_DENIED', '无权限调整 Rating 资格')
  if (training.finalizationStatus === 'FINALIZED') throw new ContestRatingError(409, 'CONTEST_ALREADY_FINALIZED', '最终榜单已生成，请使用 Rating 重放流程')
  const disposition = String(req.body.disposition || '').toUpperCase()
  if (!['NORMAL', 'EXCLUDE', 'KEEP_RESULT', 'FORCE_LAST'].includes(disposition)) throw new ContestRatingError(422, 'RATING_DISPOSITION_INVALID', 'Rating 处置无效')
  const reason = String(req.body.reason || '').trim()
  if (disposition !== 'NORMAL' && (reason.length < 5 || reason.length > 1000)) throw new ContestRatingError(422, 'RATING_DISPOSITION_REASON_REQUIRED', '非正常 Rating 处置必须填写 5～1000 字原因')
  const result = await prisma.trainingParticipant.updateMany({ where: { trainingId, userId: req.params.userId }, data: {
    ratingDisposition: disposition as any,
    ratingDispositionReason: reason || null,
    ratingDispositionBy: req.user!.userId,
    ratingDispositionAt: new Date(),
  } })
  if (!result.count) throw new ContestRatingError(404, 'PARTICIPANT_NOT_FOUND', '参赛者不存在')
  res.json({ success: true, data: { userId: req.params.userId, disposition } })
}))
