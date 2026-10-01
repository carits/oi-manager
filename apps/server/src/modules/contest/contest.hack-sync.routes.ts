import { Router } from 'express'
import { ContestContracts } from '@oi-manager/contracts'
import { asyncHandler } from '../../lib/asyncHandler'
import { parseContractBody, sendContractData, sendContractError } from '../../lib/api-contract'
import { authenticate } from '../../middleware/auth'
import { contestRoutePublicId } from './contest.helpers'
import {
  previewContestStableSnapshot,
  ContestTestSetUpdateError,
  refreshContestStableSnapshot,
} from './application/contest-testset-update.service'

export const contestHackSyncRouter = Router()

function sendTestSetUpdateError(error: unknown, res: any) {
  if (sendContractError(error, res)) return
  if (!(error instanceof ContestTestSetUpdateError)) throw error
  return res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
    ...(error.data !== undefined ? { data: error.data } : {}),
  })
}

contestHackSyncRouter.get('/contests/:id/problems/:contestProblemId/test-set-update', authenticate, asyncHandler(async (req, res) => {
  try {
    const data = await previewContestStableSnapshot(
      contestRoutePublicId(req),
      req.params.contestProblemId,
      req.user!.userId,
    )
    return sendContractData(res, ContestContracts.testSetUpdatePreview, data)
  } catch (error) {
    return sendTestSetUpdateError(error, res)
  }
}))

contestHackSyncRouter.post('/contests/:id/problems/:contestProblemId/test-set-update', authenticate, asyncHandler(async (req, res) => {
  try {
    const body = parseContractBody(ContestContracts.testSetUpdate, req.body)
    const result = await refreshContestStableSnapshot({
      contestId: contestRoutePublicId(req),
      contestProblemId: req.params.contestProblemId,
      userId: req.user!.userId,
    })
    if (!result.updated) {
      return sendContractData(res, ContestContracts.testSetUpdate, { updated: false, ...result.state })
    }
    return sendContractData(res, ContestContracts.testSetUpdate, {
      updated: true,
      previousGraphHash: result.previousGraphHash,
      currentGraphHash: result.currentGraphHash,
      currentFencingToken: result.currentFencingToken,
    })
  } catch (error) {
    return sendTestSetUpdateError(error, res)
  }
}))
