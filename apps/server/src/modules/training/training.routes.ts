/**
 * Training Module - Routes Layer
 * 训练模块路由层（子路由挂载）
 *
 * 权限规则：
 * - 团队管理员 (owner/admin)：可创建、编辑、删除训练，管理题目/题解/附件
 * - 团队成员：可查看训练、提交代码、查看排名
 * - 排名只统计学生成员（非管理员角色）
 */

import { Router } from 'express'
import { trainingCrudRouter } from './training.crud.routes'
import { trainingProblemsRouter } from './training.problems.routes'
import { trainingNotesRouter } from './training.notes.routes'
import { trainingSubmissionsRouter } from './training.submissions.routes'
import { trainingRankingRouter } from './training.ranking.routes'
import { trainingMiscRouter } from './training.misc.routes'

export const trainingsRouter = Router()

trainingsRouter.use(trainingCrudRouter)
trainingsRouter.use(trainingProblemsRouter)
trainingsRouter.use(trainingNotesRouter)
trainingsRouter.use(trainingSubmissionsRouter)
trainingsRouter.use(trainingRankingRouter)
trainingsRouter.use(trainingMiscRouter)
