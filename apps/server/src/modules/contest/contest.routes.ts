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
import { resolveContestRouteIdentity } from './contest.helpers'

export const contestRouter = Router()

contestRouter.use('/contests/:id', authenticate, async (req, res, next) => {
  if (!req.user) return next()
  const identity = await resolveContestRouteIdentity(req.params.id)
  if (!identity || !await contestMatchesWorkspaceScope(identity.publicId, req.user)) {
    return res.status(404).json({ success: false, message: '比赛不存在' })
  }

  // Downstream contest services still consume the legacy numeric publicId
  // internally. New browser/API links use canonical Contest.id; rewrite only
  // the internal router URL until those services are migrated in a later step.
  if (req.params.id !== String(identity.publicId)) {
    req.url = req.url.replace(
      /^\/contests\/[^/?]+/,
      `/contests/${identity.publicId}`,
    )
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
