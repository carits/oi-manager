import { Router } from 'express'
import { ProblemContracts } from '@oi-manager/contracts'
import { parseContractBody, sendContractData } from '../../lib/api-contract'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { getWrongCorpus, rebuildWrongCorpus } from './application/problem-wrong-corpus.service'

export const problemWrongCorpusRouter = Router()

problemWrongCorpusRouter.get('/:id/wrong-corpus', authenticate, asyncHandler(async (req, res) => {
  sendContractData(res, ProblemContracts.getWrongCorpus, await getWrongCorpus(req.user!, req.params.id))
}))

problemWrongCorpusRouter.post('/:id/wrong-corpus/rebuild', authenticate, asyncHandler(async (req, res) => {
  parseContractBody(ProblemContracts.rebuildWrongCorpus, req.body || {})
  sendContractData(res, ProblemContracts.rebuildWrongCorpus, await rebuildWrongCorpus(req.user!, req.params.id))
}))
