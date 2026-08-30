import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { getWrongCorpus, rebuildWrongCorpus } from './application/problem-wrong-corpus.service'

export const problemWrongCorpusRouter = Router()
problemWrongCorpusRouter.get('/:id/wrong-corpus', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await getWrongCorpus(req.user!, req.params.id) })))
problemWrongCorpusRouter.post('/:id/wrong-corpus/rebuild', authenticate, asyncHandler(async (req, res) => res.json({ success: true, data: await rebuildWrongCorpus(req.user!, req.params.id), message: '私有 Wrong Behavior Corpus 已重建；源码不会向贡献者公开' })))
