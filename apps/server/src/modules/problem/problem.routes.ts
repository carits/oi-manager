/**
 * Problem Module - Routes Layer
 * 题目模块路由层（路由挂载文件）
 */

import { Router } from 'express'
import { problemCrudRouter } from './problem.crud.routes'
import { problemFilesRouter } from './problem.files.routes'
import { problemNotesRouter } from './problem.notes.routes'
import { problemAiRouter } from './problem.ai.routes'
import { problemSubmissionsRouter } from './problem.submissions.routes'
import { problemJudgeRouter } from './problem.judge.routes'
import { problemUserContentRouter } from './problem.user-content.routes'
import { problemStatementVersionRouter } from './problem.statement-version.routes'
import { problemHackRouter } from './problem.hack.routes'
import { problemTestGraphRouter } from './problem.test-graph.routes'

export const problemsRouter = Router()

// 挂载子路由
problemsRouter.use(problemCrudRouter)
problemsRouter.use(problemUserContentRouter)
problemsRouter.use(problemStatementVersionRouter)
problemsRouter.use(problemHackRouter)
problemsRouter.use(problemTestGraphRouter)
problemsRouter.use(problemFilesRouter)
problemsRouter.use(problemNotesRouter)
problemsRouter.use(problemAiRouter)
problemsRouter.use(problemSubmissionsRouter)
problemsRouter.use(problemJudgeRouter)
