import { Router } from 'express'
import { authenticate, type AuthRequest } from '../../middleware/auth'
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

function contestRouteId(url: string): string | null {
  const match = /^\/contests\/([^/?]+)/.exec(url)
  return match?.[1] || null
}

// Resolve and rewrite the contest identity before any child router consumes
// the /contests/:id segment. Mounting middleware on that segment first would
// move it into req.baseUrl, leaving only the suffix in req.url and making the
// downstream numeric compatibility rewrite ineffective.
contestRouter.use((req, res, next) => {
  if (!contestRouteId(req.url)) return next()
  return authenticate(req, res, next)
})

contestRouter.use(async (req: AuthRequest, res, next) => {
  const routeId = contestRouteId(req.url)
  if (!routeId || !req.user) return next()

  const identity = await resolveContestRouteIdentity(routeId)
  if (!identity || !await contestMatchesWorkspaceScope(identity.publicId, req.user)) {
    return res.status(404).json({ success: false, message: '比赛不存在' })
  }

  req.contestPublicId = identity.publicId
  // Downstream contest services still consume the legacy numeric publicId
  // internally. New browser/API links use canonical Contest.id; rewrite only
  // the internal router URL until those services are migrated in a later step.
  if (routeId !== String(identity.publicId)) {
    req.url = req.url.replace(
      /^\/contests\/[^/?]+/,
      '/contests/' + identity.publicId,
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
