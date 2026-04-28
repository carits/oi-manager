/**
 * School Module - Routes Layer
 * 学校模块路由层（路由挂载文件）
 */

import { Router } from 'express'
import { schoolCrudRouter } from './school.crud.routes'
import { schoolMembersRouter } from './school.members.routes'
import { schoolPrincipalRouter } from './school.principal.routes'
import { schoolStatsRouter } from './school.stats.routes'
import { schoolMiscRouter } from './school.misc.routes'

export const schoolRouter = Router()

// 挂载子路由
// 注意：/current/* 路由必须在 /:id 动态路由之前挂载
schoolRouter.use(schoolMiscRouter)
schoolRouter.use(schoolMembersRouter)
schoolRouter.use(schoolPrincipalRouter)
schoolRouter.use(schoolStatsRouter)
schoolRouter.use(schoolCrudRouter)