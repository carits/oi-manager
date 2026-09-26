import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { contestCrudRouter } from './contest.crud.routes'
import { contestProblemsRouter } from './contest.problems.routes'
import { contestNotesRouter } from './contest.notes.routes'
import { contestSubmissionsRouter } from './contest.submissions.routes'
import { contestRankingRouter } from './contest.ranking.routes'
import { contestMiscRouter } from './contest.misc.routes'
import { contestRecordRouter } from './contest.record.routes'
import { contestContentRouter } from './contest.content.routes'
import { contestStatementManagementRouter } from './contest.statement-management.routes'
import { contestHackSyncRouter } from './contest.hack-sync.routes'
import { contestMatchesWorkspaceScope } from './application/contest-scope.service'

export const contestRouter = Router()

contestRouter.use('/contests/:id', authenticate, async (req, res, next) => {
  const id = Number.parseInt(req.params.id, 10)
  if (!Number.isFinite(id) || !req.user) return next()
  if (!await contestMatchesWorkspaceScope(id, req.user)) {
    return res.status(404).json({ success: false, message: '比赛不存在' })
  }
  next()
})

contestRouter.use(contestCrudRouter)
contestRouter.use(contestContentRouter)
contestRouter.use(contestStatementManagementRouter)
contestRouter.use(contestHackSyncRouter)
contestRouter.use(contestProblemsRouter)
contestRouter.use(contestNotesRouter)
contestRouter.use(contestRecordRouter)
contestRouter.use(contestSubmissionsRouter)
contestRouter.use(contestRankingRouter)
contestRouter.use(contestMiscRouter)
