/**
 * Platform Binding Module - Routes Layer
 * 平台绑定模块路由层
 */

import { Router, Request, Response } from 'express'
import { authenticate } from '../../middleware/auth'
import { PlatformBindingService } from './platform-binding.service'
import { prisma } from '../../prisma'
import type { BindingPlatform } from './platform-binding.types'

export const platformBindingRouter = Router()
const service = new PlatformBindingService()

function codeforcesArchiveInputError(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '请求参数格式无效'
  const { startTime, endTime, problemId } = body as Record<string, unknown>
  if (problemId !== undefined && (
    typeof problemId !== 'string'
    || !/^[1-9]\d{0,8}[A-Z][A-Z0-9]{0,7}$/.test(problemId)
  )) return 'Codeforces 题号格式无效'
  const start = startTime === undefined ? null : new Date(String(startTime))
  const end = endTime === undefined ? null : new Date(String(endTime))
  if (start && Number.isNaN(start.getTime())) return '开始时间格式无效'
  if (end && Number.isNaN(end.getTime())) return '结束时间格式无效'
  if (start && end && start > end) return '开始时间不能晚于结束时间'
  return null
}

/**
 * 获取支持的平台列表
 * GET /api/platform-bindings/platforms
 */
platformBindingRouter.get('/platforms', (req: Request, res: Response) => {
  const platforms = service.getSupportedPlatforms()
  res.json({ success: true, data: platforms })
})

/**
 * 获取平台的配置 Schema
 * GET /api/platform-bindings/:platform/config-schema
 */
platformBindingRouter.get('/:platform/config-schema', (req: Request, res: Response) => {
  const platform = req.params.platform as BindingPlatform
  const schema = service.getConfigSchema(platform)

  if (!schema) {
    return res.status(404).json({
      success: false,
      message: '该平台暂无配置项或平台不存在'
    })
  }

  res.json({ success: true, data: schema })
})

/**
 * 获取当前用户的所有平台绑定状态
 * GET /api/platform-bindings
 */
platformBindingRouter.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const bindings = await service.getUserBindings(userId)
    res.json({ success: true, data: bindings })
  } catch (error) {
    console.error('Get platform bindings error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

/**
 * 获取当前用户的指定平台绑定状态
 * GET /api/platform-bindings/:platform
 */
platformBindingRouter.get('/:platform', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const platform = req.params.platform as BindingPlatform

    const result = await service.getUserPlatformBinding(userId, platform)
    res.json({ success: true, data: result })
  } catch (error) {
    console.error('Get platform binding error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

/**
 * 发起平台绑定
 * POST /api/platform-bindings/:platform/bind
 */
platformBindingRouter.post('/:platform/bind', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const platform = req.params.platform as BindingPlatform
    const { platformUsername, password, extra } = req.body

    // 验证平台是否支持
    const supportedPlatforms = service.getSupportedPlatforms()
    const platformConfig = supportedPlatforms.find(p => p.id === platform)
    if (!platformConfig) {
      return res.status(400).json({ success: false, message: '不支持的平台' })
    }

    // 从 extra 中获取用户名和密码（前端发送格式）
    const actualUsername = platformUsername || extra?.username
    const actualPassword = password || extra?.password

    // 洛谷和 Codeforces 平台不需要 platformUsername（从 Cookie 自动获取）
    // 其他平台需要 platformUsername
    if (platform !== 'luogu' && platform !== 'codeforces' && !actualUsername) {
      return res.status(400).json({ success: false, message: '请输入平台用户名' })
    }

    // Cookie 模式可以替代密码（绕过 Cloudflare）
    const hasCookie = extra?.cookieString || extra?.cookies || extra?.JSESSIONID
    if (platform !== 'luogu' && platform !== 'codeforces' && !actualPassword && !hasCookie) {
      return res.status(400).json({ success: false, message: '请输入密码或提供 Cookie' })
    }

    const result = await service.bindPlatform(userId, platform, {
      platformUsername: actualUsername || '',
      password: actualPassword,
      extra
    })

    if (result.success) {
      res.json({ success: true, data: result })
    } else {
      res.status(400).json({ success: false, message: result.message })
    }
  } catch (error) {
    console.error('Bind platform error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

/**
 * 解除平台绑定
 * DELETE /api/platform-bindings/:platform
 */
platformBindingRouter.delete('/:platform', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const platform = req.params.platform as BindingPlatform

    const result = await service.unbindPlatform(userId, platform)

    if (result.success) {
      res.json({ success: true, message: result.message })
    } else {
      res.status(400).json({ success: false, message: result.message })
    }
  } catch (error) {
    console.error('Unbind platform error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

/**
 * 刷新绑定状态
 * POST /api/platform-bindings/:platform/refresh
 */
platformBindingRouter.post('/:platform/refresh', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const platform = req.params.platform as BindingPlatform

    const result = await service.refreshBinding(userId, platform)

    if (result.success) {
      res.json({ success: true, message: result.message })
    } else {
      res.status(400).json({ success: false, message: result.message })
    }
  } catch (error) {
    console.error('Refresh binding error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

/**
 * 同步归档题目（Codeforces 专用）
 * POST /api/platform-bindings/codeforces/sync-archive
 *
 * Body:
 * - startTime?: string - 开始时间（比赛/训练归档时传入）
 * - endTime?: string - 结束时间（比赛/训练归档时传入）
 * - problemId?: string - 单题归档时传入（题库页归档当前题）
 */
platformBindingRouter.post('/codeforces/sync-archive', authenticate, async (req: Request, res: Response) => {
  const inputError = codeforcesArchiveInputError(req.body)
  if (inputError) return res.status(400).json({ success: false, code: 'INVALID_ARCHIVE_REQUEST', message: inputError })
  try {
    const userId = (req as any).user.userId
    const { startTime, endTime, problemId } = req.body

    // 1. 获取用户的 CF 绑定信息
    const binding = await service.getUserPlatformBinding(userId, 'codeforces')

    if (!binding.bound) {
      return res.status(400).json({
        success: false,
        message: '请先绑定 Codeforces 账号',
      })
    }

    // 2. 获取绑定数据
    const bindingRecord = await prisma.userPlatformBinding.findUnique({
      where: { userId_platform: { userId, platform: 'codeforces' } },
    })

    if (!bindingRecord?.bindingData) {
      return res.status(400).json({
        success: false,
        message: '绑定数据不完整，请重新绑定',
      })
    }

    const bindingData = JSON.parse(bindingRecord.bindingData)
    const { jsessionid, handle } = bindingData

    if (!jsessionid || !handle) {
      return res.status(400).json({
        success: false,
        message: '绑定数据不完整，请重新绑定',
      })
    }

    // 3. 构建归档选项
    const options = {
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
      problemId, // 新增：单题归档
    }

    // 4. 执行归档同步
    const { archiveCfProblemsForUser } = await import('./binders/codeforces-archiver')
    const result = await archiveCfProblemsForUser(userId, jsessionid, handle, options)

    // 5. 改进返回信息
    let message = ''
    if (problemId) {
      // 单题归档
      if (result.count > 0) {
        message = '已将当前题加入归档'
      } else if (result.skipped > 0) {
        message = '当前题已在归档中'
      } else {
        message = '未在 Codeforces 最近 1000 条提交记录中找到该题 AC 记录'
      }
    } else {
      // 全量同步
      message = `已同步 ${result.count} 道 Codeforces AC 题目`
      if (result.skipped > 0) {
        message += `，跳过 ${result.skipped} 道已归档`
      }
    }

    res.json({
      success: true,
      message,
      data: {
        count: result.count,
        total: result.total,
        skipped: result.skipped,
        problems: result.problems.slice(0, 10), // 只返回前 10 道题目预览
      },
    })

  } catch (error) {
    if ((error as { code?: string })?.code === 'REMOTE_ARCHIVE_UNAVAILABLE') {
      return res.status(502).json({
        success: false,
        code: 'REMOTE_ARCHIVE_UNAVAILABLE',
        message: 'Codeforces 提交记录暂时无法获取，请稍后重试',
      })
    }
    console.error('Sync CF archive error:', error)
    res.status(500).json({ success: false, message: '同步归档失败' })
  }
})

/**
 * 同步 Codeforces 提交记录到 Submission 表
 * POST /api/platform-bindings/codeforces/sync-submissions
 *
 * Body:
 * - startTime?: string - 开始时间
 * - endTime?: string - 结束时间
 * - problemId?: string - 单题同步时传入
 */
platformBindingRouter.post('/codeforces/sync-submissions', authenticate, async (req: Request, res: Response) => {
  const inputError = codeforcesArchiveInputError(req.body)
  if (inputError) return res.status(400).json({ success: false, code: 'INVALID_ARCHIVE_REQUEST', message: inputError })
  try {
    const userId = (req as any).user.userId
    const { startTime, endTime, problemId } = req.body

    // 1. 获取用户的 CF 绑定信息
    const binding = await service.getUserPlatformBinding(userId, 'codeforces')

    if (!binding.bound) {
      return res.status(400).json({
        success: false,
        message: '请先绑定 Codeforces 账号',
      })
    }

    // 2. 获取绑定数据
    const bindingRecord = await prisma.userPlatformBinding.findUnique({
      where: { userId_platform: { userId, platform: 'codeforces' } },
    })

    if (!bindingRecord?.bindingData) {
      return res.status(400).json({
        success: false,
        message: '绑定数据不完整，请重新绑定',
      })
    }

    const bindingData = JSON.parse(bindingRecord.bindingData)
    const { handle } = bindingData

    if (!handle) {
      return res.status(400).json({
        success: false,
        message: '绑定数据不完整，请重新绑定',
      })
    }

    // 3. 构建同步选项
    const options = {
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
      problemId,
    }

    // 4. 执行同步
    const { syncCfSubmissionsForUser } = await import('./binders/codeforces-archiver')
    const result = await syncCfSubmissionsForUser(userId, handle, options)

    // 5. 返回结果
    let message = ''
    if (problemId) {
      // 单题同步
      if (result.count > 0) {
        message = `已同步 ${result.count} 条提交记录`
      } else if (result.skipped > 0) {
        message = '该题提交记录已存在'
      } else {
        message = '未在 Codeforces 最近 1000 条提交记录中找到该题'
      }
    } else {
      // 全量同步
      message = `已同步 ${result.count} 条提交记录`
      if (result.skipped > 0) {
        message += `，跳过 ${result.skipped} 条已存在`
      }
    }

    res.json({
      success: true,
      message,
      data: {
        count: result.count,
        total: result.total,
        skipped: result.skipped,
      },
    })

  } catch (error) {
    if ((error as { code?: string })?.code === 'REMOTE_ARCHIVE_UNAVAILABLE') {
      return res.status(502).json({
        success: false,
        code: 'REMOTE_ARCHIVE_UNAVAILABLE',
        message: 'Codeforces 提交记录暂时无法获取，请稍后重试',
      })
    }
    console.error('Sync CF submissions error:', error)
    res.status(500).json({ success: false, message: '同步提交记录失败' })
  }
})

/**
 * 同步归档题目（洛谷专用）
 * POST /api/platform-bindings/luogu/sync-archive
 *
 * Body:
 * - startTime?: string - 开始时间
 * - endTime?: string - 结束时间
 * - problemId?: string - 单题归档时传入（如 P6790）
 */
platformBindingRouter.post('/luogu/sync-archive', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const { startTime, endTime, problemId } = req.body

    // 1. 获取用户的洛谷绑定信息
    const binding = await service.getUserPlatformBinding(userId, 'luogu')

    if (!binding.bound) {
      return res.status(400).json({
        success: false,
        message: '请先绑定洛谷账号',
      })
    }

    // 2. 构建归档选项
    const options = {
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
      problemId,
    }

    // 3. 执行归档同步
    const { archiveLuoguProblemsForUser } = await import('./binders/luogu-archiver')
    const result = await archiveLuoguProblemsForUser(userId, undefined, options)

    // 4. 返回结果
    let message = ''
    if (problemId) {
      if (result.count > 0) {
        message = '已将当前题加入归档'
      } else if (result.skipped > 0) {
        message = '当前题已在归档中'
      } else {
        message = '未在洛谷找到该题 AC 记录'
      }
    } else {
      message = `已同步 ${result.count} 道洛谷 AC 题目`
      if (result.skipped > 0) {
        message += `，跳过 ${result.skipped} 道已归档`
      }
    }

    res.json({
      success: true,
      message,
      data: {
        count: result.count,
        total: result.total,
        skipped: result.skipped,
        problems: result.problems.slice(0, 10),
      },
    })

  } catch (error) {
    console.error('Sync Luogu archive error:', error)
    res.status(500).json({ success: false, message: '同步归档失败' })
  }
})

/**
 * 同步洛谷提交记录到 Submission 表
 * POST /api/platform-bindings/luogu/sync-submissions
 *
 * Body:
 * - startTime?: string - 开始时间
 * - endTime?: string - 结束时间
 * - problemId?: string - 单题同步时传入（如 P6790）
 *
 * 改进：快速同步最新一条 → 立即返回弹窗展示 → 后台异步同步剩余
 */
platformBindingRouter.post('/luogu/sync-submissions', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const { problemId } = req.body

    // 1. 获取用户的洛谷绑定信息
    const binding = await service.getUserPlatformBinding(userId, 'luogu')

    if (!binding.bound) {
      return res.status(400).json({
        success: false,
        message: '请先绑定洛谷账号',
      })
    }

    // 单题同步：使用快速同步第一条 + 异步同步剩余
    if (problemId) {
      const { syncFirstLuoguSubmission, startAsyncSyncRemaining } = await import('./binders/luogu-archiver')

      // 快速同步第一条
      const result = await syncFirstLuoguSubmission(userId, problemId)

      if (result.firstSubmission) {
        // 立即返回，后台异步同步剩余
        res.json({
          success: true,
          message: `已同步最新提交，剩余 ${result.pendingCount} 条正在后台同步`,
          data: {
            firstSubmission: result.firstSubmission,  // 用于弹窗展示
            totalCount: result.totalCount,
            pendingCount: result.pendingCount,
            skipped: result.skipped
          },
        })

        // 后台异步同步剩余（不阻塞响应）
        if (result.pendingRecordIds.length > 0) {
          startAsyncSyncRemaining(userId, problemId, result.pendingRecordIds)
        }
      } else if (result.skipped > 0) {
        res.json({
          success: true,
          message: '该题提交记录已存在',
          data: { firstSubmission: null, totalCount: result.totalCount, skipped: result.skipped }
        })
      } else {
        res.json({
          success: true,
          message: '未找到该题提交记录',
          data: { firstSubmission: null, totalCount: 0 }
        })
      }
      return
    }

    // 批量同步（无 problemId）：保持原有逻辑
    const { startTime, endTime } = req.body
    const options = {
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
    }

    const { syncLuoguSubmissionsForUser } = await import('./binders/luogu-archiver')
    const result = await syncLuoguSubmissionsForUser(userId, undefined, options)

    let message = `已同步 ${result.count} 条提交记录`
    if (result.skipped > 0) {
      message += `，跳过 ${result.skipped} 条已存在`
    }

    res.json({
      success: true,
      message,
      data: {
        count: result.count,
        total: result.total,
        skipped: result.skipped,
      },
    })

  } catch (error) {
    console.error('Sync Luogu submissions error:', error)
    res.status(500).json({ success: false, message: '同步提交记录失败' })
  }
})

/**
 * 清理重复提交记录和修复语言映射（管理员专用）
 * POST /api/platform-bindings/admin/cleanup-submissions
 *
 * Body:
 * - action: 'deduplicate' | 'fix-language' | 'all'
 */
platformBindingRouter.post('/admin/cleanup-submissions', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId
    const userRole = (req as any).user.role

    // 权限检查：只有管理员可以执行
    if (userRole !== 'super_admin' && userRole !== 'platform_admin') {
      return res.status(403).json({ success: false, message: '只有管理员可以执行清理操作' })
    }

    const { action = 'all' } = req.body
    const results: { deduplicated?: number; fixedLanguage?: number; fixedResult?: number; fixedInternalIds?: number; orphanedSubmissions?: number; testProblems?: number } = {}

    // 1. 去重：删除重复的提交记录（保留最早的一条）
    if (action === 'deduplicate' || action === 'all') {
      const duplicates = await prisma.$queryRaw<{ ojRemoteId: string; count: bigint }[]>`
        SELECT "ojRemoteId", COUNT(*) as count
        FROM "Submission"
        WHERE "ojRemoteId" IS NOT NULL
        GROUP BY "ojRemoteId"
        HAVING COUNT(*) > 1
      `

      let deduplicatedCount = 0
      for (const dup of duplicates) {
        // 获取所有重复记录，按创建时间排序
        const submissions = await prisma.submission.findMany({
          where: { ojRemoteId: dup.ojRemoteId },
          orderBy: { createdAt: 'asc' },
          select: { id: true, createdAt: true },
        })

        // 保留第一条，删除其余
        const toDelete = submissions.slice(1)
        if (toDelete.length > 0) {
          await prisma.submission.deleteMany({
            where: { id: { in: toDelete.map(s => s.id) } },
          })
          deduplicatedCount += toDelete.length
        }
      }
      results.deduplicated = deduplicatedCount
    }

    // 2. 修复语言映射：将 luogu_lang_27 和之前错误修改的 swift 改为 cpp20
    if (action === 'fix-language' || action === 'all') {
      // 修复 luogu_lang_27 -> cpp20
      const fixed1 = await prisma.submission.updateMany({
        where: { language: 'luogu_lang_27' },
        data: { language: 'cpp20' },
      })
      // 修复之前错误修改的 swift -> cpp20
      const fixed2 = await prisma.submission.updateMany({
        where: { language: 'swift' },
        data: { language: 'cpp20' },
      })
      results.fixedLanguage = fixed1.count + fixed2.count
    }

    // 3. 修复评测结果映射：统一为缩写形式
    if (action === 'fix-result' || action === 'all') {
      // unaccepted -> wa
      const fixedResult1 = await prisma.submission.updateMany({
        where: { result: 'unaccepted' },
        data: { result: 'wa' },
      })
      // wrong_answer -> wa
      const fixedResult2 = await prisma.submission.updateMany({
        where: { result: 'wrong_answer' },
        data: { result: 'wa' },
      })
      // compilation_error -> ce
      const fixedResult3 = await prisma.submission.updateMany({
        where: { result: 'compilation_error' },
        data: { result: 'ce' },
      })
      // compile_error -> ce
      const fixedResult4 = await prisma.submission.updateMany({
        where: { result: 'compile_error' },
        data: { result: 'ce' },
      })
      // waiting -> queuing
      const fixedResult5 = await prisma.submission.updateMany({
        where: { result: 'waiting' },
        data: { result: 'queuing' },
      })
      results.fixedResult = fixedResult1.count + fixedResult2.count + fixedResult3.count + fixedResult4.count + fixedResult5.count
    }

    // 4. 修复 problemInternalId：对无 problemInternalId 但 Problem 表中存在对应题目的提交补全关联
    if (action === 'fix-internal-ids' || action === 'all') {
      const submissions = await prisma.submission.findMany({
        where: { problemInternalId: null },
        select: { id: true, oj: true, problemId: true },
      })

      let fixed = 0
      for (const sub of submissions) {
        const problem = await prisma.problem.findFirst({
          where: { libraryScope: 'platform', platform: sub.oj, problemId: sub.problemId },
        })
        if (problem) {
          await prisma.submission.update({
            where: { id: sub.id },
            data: { problemInternalId: problem.id },
          })
          fixed++
        }
      }
      results.fixedInternalIds = fixed
    }

    // 5. 清理 Carits 测试数据（只删除 Carits，不碰其他平台）
    //    顺序：先删提交 → 删所有关联记录 → 再删题目（避免 FK 冲突）
    if (action === 'clean-orphaned' || action === 'all') {
      // 5a. 删除无 problemInternalId 的 Carits 提交
      const caritsOrphaned = await prisma.submission.deleteMany({
        where: { oj: 'carits', problemInternalId: null },
      })
      // 5b. 找到所有 Carits 测试题目
      const testProblemIds = await prisma.problem.findMany({
        where: {
          libraryScope: 'platform',
          platform: 'carits',
          OR: [{ title: { contains: '测试' } }, { title: { contains: '兼容' } }],
        },
        select: { id: true },
      })
      let testSubmissionCount = 0
      if (testProblemIds.length > 0) {
        const ids = testProblemIds.map(p => p.id)
        // 5b-1. 删除关联到测试题目的 Carits 提交
        const deleted = await prisma.submission.deleteMany({
          where: { oj: 'carits', problemInternalId: { in: ids } },
        })
        testSubmissionCount = deleted.count
        // 5b-2. 删除所有引用测试题目的关联记录（按依赖顺序）
        await prisma.trainingProblem.deleteMany({ where: { problemId: { in: ids } } })
        await prisma.problemListEntry.deleteMany({ where: { problemId: { in: ids } } })
        await prisma.problemNote.deleteMany({ where: { problemId: { in: ids } } })
        await prisma.problemStatement.deleteMany({ where: { problemId: { in: ids } } })
        await prisma.testdataFile.deleteMany({ where: { problemId: { in: ids } } })
        await prisma.problemAttachment.deleteMany({ where: { problemId: { in: ids } } })
      }
      // 5c. 删除测试题目
      const testProblems = await prisma.problem.deleteMany({
        where: {
          libraryScope: 'platform',
          platform: 'carits',
          OR: [{ title: { contains: '测试' } }, { title: { contains: '兼容' } }],
        },
      })
      results.orphanedSubmissions = caritsOrphaned.count + testSubmissionCount
      results.testProblems = testProblems.count
    }

    res.json({
      success: true,
      message: '清理完成',
      data: results,
    })

  } catch (error) {
    console.error('Cleanup submissions error:', error)
    res.status(500).json({ success: false, message: '清理失败' })
  }
})
