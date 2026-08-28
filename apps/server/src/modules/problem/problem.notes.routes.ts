import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { getProblemNote, saveProblemNote } from './application/problem-route.service'

export const problemNotesRouter = Router()

function sendNoteResult(result: any, res: any) {
  if (result.error === 'not_found') return res.status(404).json({ success: false, message: '题目不存在' })
  if (result.error === 'owner_missing') return res.status(403).json({ success: false, message: '用户信息不存在' })
  return res.json({ success: true, data: result.note })
}

problemNotesRouter.get('/:id/note', authenticate, asyncHandler(async (req, res) => {
  return sendNoteResult(await getProblemNote(req.user!, req.params.id), res)
}))

problemNotesRouter.put('/:id/note', authenticate, asyncHandler(async (req, res) => {
  return sendNoteResult(await saveProblemNote(req.user!, req.params.id, req.body?.content), res)
}))
