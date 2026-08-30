import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { isPlatformAdministrator } from '../featureAvailability'
import { adjustAiTokenPool, AiTokenError, getAiTokenPool, listAiTokenUsage } from './ai-token.service'
import { getEvaluationBudgetOverview } from '../problem/problem.evaluation-budget.service'
export const aiTokenAdminRouter = Router()
function guard(req: any, res: any) { if (!isPlatformAdministrator(req.user)) { res.status(403).json({ success: false, message: '仅平台管理员可管理 AI Token' }); return false } return true }
function send(error: unknown, res: any) { if (!(error instanceof AiTokenError)) throw error; return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message }) }
aiTokenAdminRouter.get('/token-pool', asyncHandler(async (req, res) => { if (!guard(req, res)) return; res.json({ success: true, data: await getAiTokenPool() }) }))
aiTokenAdminRouter.get('/token-usage', asyncHandler(async (req, res) => { if (!guard(req, res)) return; res.json({ success: true, data: await listAiTokenUsage() }) }))
aiTokenAdminRouter.get('/evaluation-budget', asyncHandler(async (req, res) => { if (!guard(req, res)) return; res.json({ success: true, data: await getEvaluationBudgetOverview() }) }))
aiTokenAdminRouter.post('/token-pool/adjust', asyncHandler(async (req, res) => { if (!guard(req, res)) return; try { res.json({ success: true, data: await adjustAiTokenPool({ amount: Number(req.body?.amount), idempotencyKey: String(req.body?.idempotencyKey || ''), reason: String(req.body?.reason || ''), operatorUserId: req.user!.userId }) }) } catch (error) { return send(error, res) } }))
