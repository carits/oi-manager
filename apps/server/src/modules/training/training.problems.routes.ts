/**
 * Training Problem Routes
 * 训练题目管理路由
 */

import { Router } from 'express'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import type { AuthRequest } from '../../middleware/auth'
import { getAdapter, getSupportedPlatforms } from '../../oj-adapters'
import {
  canAccessTraining,
  canManageTraining,
  getUserTypeForTeam,
  parseTrainingId,
  requireTrainingStarted,
} from './training.helpers'
import { getTrainingRuntimeStatus, shouldHideTrainingProblemSource } from './training.visibility'
import { buildContestProblemStatus } from './training.problem-status'
import {
  addManagedTrainingProblem,
  deleteManagedTrainingProblem,
  reorderManagedTrainingProblems,
  TrainingProblemManagementError,
  updateManagedTrainingProblem,
} from './application/training-problem-management.service'
import {
  findTrainingForProblemAccess,
  getTrainingProblemDetailData,
  getTrainingProblemStatusData,
  listTrainingProblems,
} from './application/training-problem-query.service'
import yaml from 'js-yaml'
import { legacySubmissionIoSuggestion } from '../judge/domain/submission-io'

function sendManagementError(error: unknown, res: any) {
  if (!(error instanceof TrainingProblemManagementError)) throw error
  return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message })
}

const managedProblemFilePattern = /\/api\/files\/([^/?#]+)\/(?:download|public)/g

function contextualizeProblemContent(trainingId: number, trainingProblemId: string, content: string | null) {
  if (!content) return content
  managedProblemFilePattern.lastIndex = 0
  return content.replace(managedProblemFilePattern, (_url, fileId: string) =>
    `/api/trainings/${trainingId}/problems/${trainingProblemId}/files/${fileId}`)
}

function contextualizeProblemFile(trainingId: number, trainingProblemId: string, fileUrl: string | null) {
  if (!fileUrl) return fileUrl
  managedProblemFilePattern.lastIndex = 0
  const match = managedProblemFilePattern.exec(fileUrl)
  return match?.[1]
    ? `/api/trainings/${trainingId}/problems/${trainingProblemId}/files/${match[1]}`
    : fileUrl
}

export const trainingProblemsRouter = Router()

/**
 * GET /api/trainings/:id/problems
 * 获取训练题目列表
 */
trainingProblemsRouter.get('/trainings/:id/problems', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await findTrainingForProblemAccess(id, true)
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
    }

    const notStarted = await requireTrainingStarted(training, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const isAdmin = await canManageTraining(userId, training)

    const problems = await listTrainingProblems(id)

    const hideProblemIdentity = shouldHideTrainingProblemSource(training, isAdmin)
    res.json({
      success: true,
      data: problems.map(p => {
        // 附件数量 = 原始题目附件 + 训练特定附件
        const attachmentCount = (p.Problem?._count?.ProblemAttachment ?? 0) + p._count.TrainingAttachment
        const base: any = {
          id: p.id,
          points: p.points,
          hasSolution: !!p.TrainingSolution,
          solutionVisible: p.TrainingSolution?.visible ?? false,
          attachmentCount,
          problemSourceHidden: hideProblemIdentity,
          ...(isAdmin ? {
            contentSelection: {
              statement: p.ContentSnapshot.find(item => item.kind === 'statement') || null,
              solution: p.ContentSnapshot.find(item => item.kind === 'solution') || null,
            },
          } : {}),
        }

        return {
          ...base,
          orderIndex: p.orderIndex,
          difficulty: p.Problem.difficulty,
          timeLimit: p.Problem.timeLimit,
          memoryLimit: p.Problem.memoryLimit,
          ...(hideProblemIdentity ? {} : {
            alias: p.alias,
            problemId: p.Problem.id,
            problemTitle: p.Problem.title,
            platform: p.Problem.platform,
            platformProblemId: p.Problem.problemId,
          }),
        }
      }),
    })
}, '查询失败'))

/**
 * GET /api/trainings/:id/problem-status
 * 获取题目列表（含当前用户提交状态和原题链接）
 * 所有团队成员可见来源信息（与题面tab隐藏来源策略不同）
 */
trainingProblemsRouter.get('/trainings/:id/problem-status', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId

    const training = await findTrainingForProblemAccess(id)
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
    }

    const notStarted = await requireTrainingStarted(training, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const submitScopeValue = training.type === 'contest' ? 'contest' : 'training'
    const { problems, submissions } = await getTrainingProblemStatusData(id, userId, submitScopeValue)

    // Group submissions by source problem ID so each format can expose one stable display status.
    const submissionsByProblem = new Map<string, typeof submissions>()
    for (const submission of submissions) {
      const list = submissionsByProblem.get(submission.problemId) || []
      list.push(submission)
      submissionsByProblem.set(submission.problemId, list)
    }

    // 平台名称映射（含 Carits 内部平台）
    const platformLabelMap = new Map<string, string>([
      ...getSupportedPlatforms().map(p => [p.platform, p.name] as [string, string]),
      ['carits', 'Carits'],
    ])

    // OI 赛制可见性检查
    const isAdminUser = await canManageTraining(userId, training)
    const computedStatus = getTrainingRuntimeStatus(training)
    const hideOiStatus = training.format === 'oi' && computedStatus !== 'finished' && !isAdminUser

    const hideProblemIdentity = shouldHideTrainingProblemSource(training, isAdminUser)

    // 构建结果
    const result = problems.map(p => {
      const platform = p.Problem.platform
      const platformProblemId = p.Problem.problemId
      const status = buildContestProblemStatus(training.format, submissionsByProblem.get(platformProblemId) || [])

      // 生成原题链接
      let problemUrl: string | null = null
      try {
        if (platform === 'carits') {
          problemUrl = '__carits__'
        } else if (platform) {
          const adapter = getAdapter(platform as any)
          problemUrl = adapter.getProblemUrl(platformProblemId)
        }
      } catch {
        // 平台不支持生成链接，忽略
      }

      return {
        id: p.id,
        points: p.points,
        problemSourceHidden: hideProblemIdentity,
        orderIndex: p.orderIndex,
        ...(hideProblemIdentity ? {} : {
          alias: p.alias,
          title: p.Problem.title,
          problemTitle: p.Problem.title,
        }),
        ...(hideProblemIdentity ? {} : {
          platform: platform || null,
          platformProblemId: platformProblemId || null,
          problemTableId: p.Problem.id,
          platformLabel: platformLabelMap.get(platform as any) || platform || '',
          problemUrl,
        }),
        hasSubmitted: status.hasSubmitted,
        bestScore: hideOiStatus ? null : status.bestScore,
        bestResult: hideOiStatus ? null : status.bestResult,
        latestResult: hideOiStatus ? null : status.latestResult,
        hasAccepted: status.hasAccepted,
        displayStatus: hideOiStatus ? (status.hasSubmitted ? 'submitted' : null) : status.displayStatus,
      }
    })

    res.json({ success: true, data: { problems: result } })
}, '查询失败'))

/**
 * POST /api/trainings/:id/problems
 * 添加训练题目
 */
trainingProblemsRouter.post('/trainings/:id/problems', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { problemId, alias, points, statementOptionKey, solutionOptionKey } = req.body

    const training = await findTrainingForProblemAccess(id, true)
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    if (!problemId) {
      return res.status(400).json({ success: false, message: '题目ID为必填' })
    }

    try {
      const trainingProblem = await addManagedTrainingProblem({
        training,
        user: req.user!,
        problemId,
        alias,
        points,
        statementOptionKey: typeof statementOptionKey === 'string' ? statementOptionKey : undefined,
        solutionOptionKey: typeof solutionOptionKey === 'string' ? solutionOptionKey : undefined,
      })
      return res.json({ success: true, data: trainingProblem })
    } catch (error) {
      return sendManagementError(error, res)
    }
}, '添加失败'))

/**
 * PUT /api/trainings/:id/problems/reorder
 * 重排题目顺序
 */
trainingProblemsRouter.put('/trainings/:id/problems/reorder', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id)
    const userId = req.user!.userId
    const { orders } = req.body as { orders: Array<{ id: string; orderIndex: number }> }

    const training = await findTrainingForProblemAccess(id)
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    try { await reorderManagedTrainingProblems(id, orders) }
    catch (error) { return sendManagementError(error, res) }

    res.json({ success: true, message: '排序已更新' })
}, '排序失败'))

/**
 * PUT /api/trainings/:id/problems/:problemId
 * 更新训练题目
 */
trainingProblemsRouter.put('/trainings/:id/problems/:problemId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId
    const { alias, points } = req.body

    const training = await findTrainingForProblemAccess(id)
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    let updated
    try { updated = await updateManagedTrainingProblem(id, problemId, { alias, points }) }
    catch (error) { return sendManagementError(error, res) }

    res.json({ success: true, data: updated })
}, '更新失败'))

/**
 * DELETE /api/trainings/:id/problems/:problemId
 * 删除训练题目
 */
trainingProblemsRouter.delete('/trainings/:id/problems/:problemId', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await findTrainingForProblemAccess(id)
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canManageTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '只有团队管理员可以管理题目' })
    }

    try { await deleteManagedTrainingProblem(id, problemId) }
    catch (error) { return sendManagementError(error, res) }

    res.json({ success: true, message: '删除成功' })
}, '删除失败'))

/**
 * GET /api/trainings/:id/problems/:problemId/detail
 * 获取训练题目详情（题面内容）
 */
trainingProblemsRouter.get('/trainings/:id/problems/:problemId/detail', authenticate, asyncHandler(async (req: AuthRequest, res) => {
    const id = parseTrainingId(req.params.id), problemId = req.params.problemId
    const userId = req.user!.userId

    const training = await findTrainingForProblemAccess(id)
    if (!training) {
      return res.status(404).json({ success: false, message: '训练不存在' })
    }

    if (!await canAccessTraining(userId, training)) {
      return res.status(403).json({ success: false, message: '无权限查看' })
    }

    const notStarted = await requireTrainingStarted(training, userId)
    if (notStarted) {
      return res.status(403).json({ success: false, message: notStarted })
    }

    const isAdmin = await canManageTraining(userId, training)
    const userType = await getUserTypeForTeam(userId)
    const detail = await getTrainingProblemDetailData(id, problemId, userId, userType)
    if (!detail) return res.status(403).json({ success: false, message: '题目不属于该训练' })
    const { trainingProblem, note, statementSet, legacyStatementSnapshot } = detail
    const legacyIo = legacySubmissionIoSuggestion(yaml.load(trainingProblem.judgeConfigSnapshot || '{}') as any)

    const hideProblemIdentity = shouldHideTrainingProblemSource(training, isAdmin)
    const defaultStatement = statementSet?.Snapshot.find(item => item.isDefault) || statementSet?.Snapshot[0]
    // 返回题面内容；赛中“题号赛后显示”时不返回任何原题识别字段。
    const problem = trainingProblem.Problem
    const snapshotStatement = statementSet ? statementSet.Snapshot.map(statement => ({
      id: statement.id, type: 'statement', name: statement.name,
      format: statement.format, language: statement.language,
      content: contextualizeProblemContent(id, trainingProblem.id, statement.content),
      fileUrl: statement.snapshotFileId ? `/api/trainings/${id}/problems/${trainingProblem.id}/statement-versions/${statement.id}/file` : null,
      isVisible: true, isDefault: statement.isDefault, authorUsername: statement.authorUsernameSnapshot || 'System',
    })) : legacyStatementSnapshot ? [{
      id: legacyStatementSnapshot.id, type: 'statement', name: legacyStatementSnapshot.title || '官方题面',
      format: legacyStatementSnapshot.format, language: legacyStatementSnapshot.language,
      content: contextualizeProblemContent(id, trainingProblem.id, legacyStatementSnapshot.content),
      fileUrl: legacyStatementSnapshot.snapshotFileId ? `/api/trainings/${id}/problems/${trainingProblem.id}/content-snapshot/statement/file` : null,
      isVisible: true, isDefault: true, authorUsername: legacyStatementSnapshot.authorUsernameSnapshot || 'System',
    }] : null
    res.json({
      success: true,
      data: {
        problemSourceHidden: hideProblemIdentity,
        orderIndex: trainingProblem.orderIndex,
        points: trainingProblem.points,
        timeLimit: trainingProblem.timeLimitSnapshot ?? problem.timeLimit,
        memoryLimit: trainingProblem.memoryLimitSnapshot ?? problem.memoryLimit,
        difficulty: problem.difficulty,
        description: defaultStatement?.content ?? legacyStatementSnapshot?.content ?? problem.description,
        statementType: defaultStatement?.format ?? legacyStatementSnapshot?.format ?? problem.statementType,
        statementPdfUrl: defaultStatement?.snapshotFileId
          ? `/api/trainings/${id}/problems/${trainingProblem.id}/statement-versions/${defaultStatement.id}/file`
          : legacyStatementSnapshot?.snapshotFileId
          ? `/api/trainings/${id}/problems/${trainingProblem.id}/content-snapshot/statement/file`
          : contextualizeProblemFile(id, trainingProblem.id, problem.statementPdfUrl),
        statements: snapshotStatement || problem.ProblemStatement.map(statement => ({
          ...statement,
          content: contextualizeProblemContent(id, trainingProblem.id, statement.content),
          fileUrl: contextualizeProblemFile(id, trainingProblem.id, statement.fileUrl),
        })),
        noteContent: note?.content ?? '',
        contentRevision: statementSet?.revision ?? legacyStatementSnapshot?.revision ?? null,
        contentSource: defaultStatement?.sourceType ?? legacyStatementSnapshot?.sourceType ?? 'canonical',
        legacyIoSuggestion: legacyIo ? { inputFilename: legacyIo.inputFilename, outputFilename: legacyIo.outputFilename } : null,
        ...(isAdmin && (defaultStatement?.authorUsernameSnapshot || legacyStatementSnapshot?.authorUsernameSnapshot)
          ? { authorUsername: defaultStatement?.authorUsernameSnapshot || legacyStatementSnapshot?.authorUsernameSnapshot }
          : {}),
        ...(!hideProblemIdentity && {
          alias: trainingProblem.alias,
          problemTitle: defaultStatement?.title || legacyStatementSnapshot?.title || trainingProblem.titleSnapshot || problem.title,
        }),
        // 管理员额外信息
        ...(isAdmin && {
          problemTitle: defaultStatement?.title || legacyStatementSnapshot?.title || trainingProblem.titleSnapshot || problem.title,
          platform: problem.platform,
          platformProblemId: problem.problemId,
        }),
      },
    })
}, '查询失败'))
