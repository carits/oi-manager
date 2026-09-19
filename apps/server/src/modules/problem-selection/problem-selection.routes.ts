import { Router } from 'express'
import { ProblemSelectionContracts } from '@oi-manager/contracts'
import { authenticate, type AuthRequest } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { ApiContractError, parseContractBody, sendContractData } from '../../lib/api-contract'
import { resolveProblemSelection } from './problem-selection.service'

export const problemSelectionRouter = Router()

problemSelectionRouter.post('/problem-selection/resolve', authenticate, asyncHandler(async (req: AuthRequest, res) => {
  let body
  try {
    body = parseContractBody(ProblemSelectionContracts.resolve, req.body)
  } catch (error) {
    if (error instanceof ApiContractError && error.statusCode === 422) {
      return res.status(422).json({ success: false, code: 'INVALID_PROBLEM_SELECTION', message: '题号解析请求不合法', details: error.issues })
    }
    throw error
  }
  return sendContractData(res, ProblemSelectionContracts.resolve, await resolveProblemSelection(req.user!, body))
}, '解析题号失败'))
