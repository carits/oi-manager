import { Router, type Response } from 'express'
import { RankingContracts } from '@oi-manager/contracts'
import { authenticate, AuthRequest, isPersonalContext } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractQuery, sendContractData, sendContractError } from '../../lib/api-contract'
import {
  getOrganizationRanking,
  getPersonalRatingRanking,
  getPersonalSolvedRanking,
  RankingApplicationError,
} from './application/ranking.service'

export const rankingRouter = Router()

function rankingEndpoint(handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try { await handler(req, res) }
    catch (error) {
      if (sendContractError(error, res)) return
      if (error instanceof RankingApplicationError) {
        return res.status(error.statusCode).json({ success: false, message: error.message })
      }
      throw error
    }
  })
}

function requirePersonalMode(req: AuthRequest, res: any): boolean {
  if (!req.user || !isPersonalContext(req.user)) {
    res.status(403).json({
      success: false,
      code: 'WORKSPACE_MODE_REQUIRED',
      message: '该排名仅在个人工作区可用',
    })
    return false
  }
  return true
}

rankingRouter.get('/personal/rating', authenticate, rankingEndpoint(async (req, res) => {
  if (!requirePersonalMode(req, res)) return
  const query = parseContractQuery(RankingContracts.personalRating, req.query)
  sendContractData(res, RankingContracts.personalRating, await getPersonalRatingRanking(query))
}))

rankingRouter.get('/personal/solved', authenticate, rankingEndpoint(async (req, res) => {
  if (!requirePersonalMode(req, res)) return
  const query = parseContractQuery(RankingContracts.personalSolved, req.query)
  sendContractData(res, RankingContracts.personalSolved, await getPersonalSolvedRanking(query))
}))

rankingRouter.get('/organizations/:organizationId/:metric', authenticate, rankingEndpoint(async (req, res) => {
  const organizationId = req.params.organizationId
  const metric = req.params.metric
  if (!req.user || isPersonalContext(req.user) || req.user.organizationId !== organizationId) return res.status(403).json({ success: false, message: '当前组织上下文无效' })
  const query = parseContractQuery(RankingContracts.organization, req.query)
  sendContractData(res, RankingContracts.organization, await getOrganizationRanking(organizationId, metric, query))
}))
