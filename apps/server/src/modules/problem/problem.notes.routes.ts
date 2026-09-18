import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { getProblemNote, saveProblemNote } from './application/problem-route.service'
import { ProblemContracts } from '@oi-manager/contracts'
import { parseContractBody, sendContractData } from '../../lib/api-contract'

export const problemNotesRouter = Router()

function sendNoteResult(result: any, res: any, contract: typeof ProblemContracts.getNote | typeof ProblemContracts.saveNote) {
  if (result.error === 'not_found') return res.status(404).json({ success: false, message: '题目不存在' })
  if (result.error === 'owner_missing') return res.status(403).json({ success: false, message: '用户信息不存在' })
  return sendContractData(res, contract, result.note)
}

problemNotesRouter.get('/:id/note', authenticate, asyncHandler(async (req, res) => {
  return sendNoteResult(await getProblemNote(req.user!, req.params.id), res, ProblemContracts.getNote)
}))

problemNotesRouter.put('/:id/note', authenticate, asyncHandler(async (req, res) => {
  const body = parseContractBody(ProblemContracts.saveNote, req.body)
  return sendNoteResult(await saveProblemNote(req.user!, req.params.id, body.content), res, ProblemContracts.saveNote)
}))
