/**
 * Team Module - Routes Layer
 * 团队模块路由层（子路由挂载）
 *
 * 只负责：路由定义、请求解析、响应格式化
 */

import { Router } from 'express'
import { teamCrudRouter } from './team.crud.routes'
import { teamMembersRouter } from './team.members.routes'
import { teamInvitationsRouter } from './team.invitations.routes'
import { teamRequestsRouter } from './team.requests.routes'

export const teamRouter = Router()

teamRouter.use(teamInvitationsRouter)
teamRouter.use(teamRequestsRouter)
teamRouter.use(teamCrudRouter)
teamRouter.use(teamMembersRouter)
