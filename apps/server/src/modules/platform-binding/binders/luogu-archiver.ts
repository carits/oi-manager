/**
 * Luogu Submission Archiver
 * 洛谷提交记录归档抓取逻辑
 *
 * 功能：从洛谷抓取用户的提交记录，并归档到本地 Submission 表
 *
 * 关键：洛谷 API 需要处理 C3VK 挑战页，通过 LuoguSession 处理会话
 */

import { prisma } from '../../../prisma'
import logger from '../../../lib/logger'
import { LuoguSession } from './luogu-session'

const LUOGU_BASE = 'https://www.luogu.com.cn'

/**
 * 洛谷提交记录
 */
export interface LuoguSubmissionRecord {
  recordId: string        // 洛谷提交 ID (如 "123456789")
  problemId: string       // 题号（如 "P6790", "B2001", "AT_xxx"）
  result: string          // 评测结果（accepted, wrong_answer 等）
  score: number           // 分数
  language: string        // 编程语言
  timeUsed: number        // 耗时 ms
  memoryUsed: number      // 内存 KB
  submittedAt: Date       // 提交时间
  code?: string           // 源代码（需额外请求获取）
}

/**
 * 归档选项
 */
export interface ArchiveOptions {
  startTime?: Date        // 开始时间过滤
  endTime?: Date          // 结束时间过滤
  problemId?: string      // 单题归档
}

/**
 * 同步结果
 */
export interface SyncResult {
  count: number           // 新同步数量
  total: number           // 本次抓取到的提交总数
  skipped: number         // 已存在跳过的数量
}

/**
 * 洛谷评测结果转换为 Submission result
 */
function convertLuoguResult(result: string): string {
  const resultMap: Record<string, string> = {
    'accepted': 'accepted',
    'wrong_answer': 'wrong_answer',
    'time_limit_exceeded': 'time_limit_exceeded',
    'memory_limit_exceeded': 'memory_limit_exceeded',
    'runtime_error': 'runtime_error',
    'compile_error': 'compilation_error',
    'output_limit_exceeded': 'output_limit_exceeded',
    'waiting': 'waiting',
    'judging': 'judging',
    'skipped': 'skipped',
    'hack_successful': 'hacked',
    'hack_unsuccessful': 'hacked',
  }
  return resultMap[result.toLowerCase()] || result.toLowerCase()
}

/**
 * 从用户提交页面解析提交列表（备用方式）
 * 洛谷 API 可能不稳定，需要回退到页面抓取
 */
function parseUserSubmissionsPage(data: any): LuoguSubmissionRecord[] {
  const submissions: LuoguSubmissionRecord[] = []

  // 从 _feInjection.currentData 或 lentille-context.data 解析
  const records = data?.data?.records?.result || data?.records?.result || []

  for (const item of records) {
    if (!item?.submission || !item?.problem) continue

    const sub = item.submission
    const problem = item.problem

    submissions.push({
      recordId: String(sub.id || ''),
      problemId: problem.pid || '',
      result: sub.status?.toString()?.toLowerCase() || 'unknown',
      score: sub.score || 0,
      language: sub.language || 'unknown',
      timeUsed: sub.time || 0,
      memoryUsed: sub.memory || 0,
      submittedAt: sub.submitTime ? new Date(sub.submitTime * 1000) : new Date(),
    })
  }

  return submissions
}

/**
 * 获取用户对某题的提交记录（优先 API 方式）
 *
 * @param session - LuoguSession 实例（已处理 C3VK）
 * @param uid - 洛谷用户 ID
 * @param options - 过滤选项
 * @returns 提交记录列表
 */
export async function fetchLuoguSubmissions(
  session: LuoguSession,
  uid: string,
  options?: ArchiveOptions
): Promise<LuoguSubmissionRecord[]> {
  const submissions: LuoguSubmissionRecord[] = []

  // 方式 1：API 方式（优先尝试）
  const endpoint = `/api/user/submissions?uid=${uid}&page=1`

  try {
    const result = await session.fetchApi(endpoint, {
      'Referer': `${LUOGU_BASE}/user/${uid}#submissions`,
    })

    if (result.ok && result.data) {
      const records = result.data?.data?.records?.result || result.data?.records?.result || []

      for (const item of records) {
        if (!item?.submission || !item?.problem) continue

        const sub = item.submission
        const problem = item.problem
        const pid = problem.pid || ''

        // 单题过滤
        if (options?.problemId && pid !== options.problemId) continue

        // 时间范围过滤
        const submittedAt = sub.submitTime ? new Date(sub.submitTime * 1000) : new Date()
        if (options?.startTime && submittedAt < options.startTime) continue
        if (options?.endTime && submittedAt > options.endTime) continue

        submissions.push({
          recordId: String(sub.id || ''),
          problemId: pid,
          result: sub.status?.toString()?.toLowerCase() || 'unknown',
          score: sub.score || 0,
          language: sub.language || 'unknown',
          timeUsed: sub.time || 0,
          memoryUsed: sub.memory || 0,
          submittedAt,
        })
      }

      if (submissions.length > 0) {
        logger.info('luogu_archiver_api_success', {
          action: 'fetch_luogu_submissions',
          metadata: { uid, count: submissions.length }
        })
        return submissions
      }
    }
  } catch (apiErr) {
    logger.warn('luogu_archiver_api_failed_fallback_page', {
      action: 'fetch_luogu_submissions',
      metadata: { uid, detail: (apiErr as Error).message }
    })
  }

  // 方式 2：页面抓取（备用）
  const pageUrl = `${LUOGU_BASE}/user/${uid}#submissions`
  try {
    const html = await session.fetchPageContent(pageUrl)
    const data = session.parsePageData(html)
    const parsed = parseUserSubmissionsPage(data)

    // 过滤
    for (const sub of parsed) {
      if (options?.problemId && sub.problemId !== options.problemId) continue
      if (options?.startTime && sub.submittedAt < options.startTime) continue
      if (options?.endTime && sub.submittedAt > options.endTime) continue
      submissions.push(sub)
    }

    logger.info('luogu_archiver_page_success', {
      action: 'fetch_luogu_submissions',
      metadata: { uid, count: submissions.length }
    })
  } catch (pageErr) {
    logger.error('luogu_archiver_page_failed', pageErr as Error, {
      action: 'fetch_luogu_submissions',
      metadata: { uid }
    })
  }

  return submissions
}

/**
 * 获取提交详情（含源代码）
 *
 * @param session - LuoguSession 实例
 * @param recordId - 提交 ID
 * @returns 提交详情（含代码）
 */
export async function fetchLuoguRecordDetail(
  session: LuoguSession,
  recordId: string
): Promise<{ code: string; language: string; detail: any } | null> {
  const recordUrl = `${LUOGU_BASE}/record/${recordId}`

  try {
    const html = await session.fetchPageContent(recordUrl)
    const data = session.parsePageData(html)

    // 从数据中提取代码和语言
    const detail = data?.data?.record?.detail || data?.record?.detail || {}
    const code = detail?.code || ''
    const language = detail?.language || 'unknown'

    return { code, language, detail }
  } catch (err) {
    logger.error('luogu_archiver_record_detail_failed', err as Error, {
      action: 'fetch_luogu_record_detail',
      metadata: { recordId }
    })
    return null
  }
}

/**
 * 同步洛谷提交记录到 Submission 表
 *
 * @param userId - 用户 ID
 * @param uid - 洛谷用户 ID（可省略，从绑定数据获取）
 * @param options - 过滤选项
 * @param ojAccountId - 平台绑定记录 ID（用于关联）
 * @returns 同步结果
 */
export async function syncLuoguSubmissionsForUser(
  userId: string,
  uid?: string,
  options?: ArchiveOptions,
  ojAccountId?: string
): Promise<SyncResult> {
  // 1. 查询绑定数据
  const binding = await prisma.userPlatformBinding.findUnique({
    where: { userId_platform: { userId, platform: 'luogu' } }
  })

  if (!binding || binding.bindingStatus !== 'bound' || !binding.bindingData) {
    logger.error('luogu_archiver_no_binding', undefined, {
      action: 'sync_luogu_submissions',
      metadata: { userId }
    })
    return { count: 0, total: 0, skipped: 0 }
  }

  const bindingData = JSON.parse(binding.bindingData)
  const clientId = bindingData.clientId
  const uidCookie = bindingData.uidCookie || bindingData.uid || uid

  if (!clientId || !uidCookie) {
    logger.error('luogu_archiver_binding_data_missing', undefined, {
      action: 'sync_luogu_submissions',
      metadata: { userId, detail: 'missing clientId or uid' }
    })
    return { count: 0, total: 0, skipped: 0 }
  }

  // 2. 创建 session
  const session = await LuoguSession.fromBinding(userId)
  if (!session) {
    logger.error('luogu_archiver_session_failed', undefined, {
      action: 'sync_luogu_submissions',
      metadata: { userId }
    })
    return { count: 0, total: 0, skipped: 0 }
  }

  // 3. 获取提交记录
  const submissions = await fetchLuoguSubmissions(session, uidCookie, options)

  // 4. 查询已存在的提交（通过 ojRemoteId 去重）
  const existingSubmissions = await prisma.submission.findMany({
    where: {
      userId,
      oj: 'luogu',
      ojRemoteId: { in: submissions.map(s => s.recordId) },
    },
    select: { ojRemoteId: true },
  })
  const existingIds = new Set(existingSubmissions.map(s => s.ojRemoteId))

  // 5. 批量创建新提交记录
  let count = 0
  for (const sub of submissions) {
    if (existingIds.has(sub.recordId)) continue

    try {
      // 可选：获取源代码
      let code = ''
      try {
        const detail = await fetchLuoguRecordDetail(session, sub.recordId)
        if (detail) {
          code = detail.code
        }
      } catch {
        // 获取代码失败，使用空字符串
      }

      await prisma.submission.create({
        data: {
          userId,
          oj: 'luogu',
          ojRemoteId: sub.recordId,
          problemId: sub.problemId,
          result: convertLuoguResult(sub.result),
          language: sub.language,
          timeUsed: sub.timeUsed,
          memoryUsed: sub.memoryUsed,
          createdAt: sub.submittedAt,
          submitScope: 'problem',
          code,
          codeLength: code.length,
          submitMethod: 'archive',
          score: sub.score,
          isGlobalVisible: true,
          ojAccountId: ojAccountId || undefined,
        },
      })
      count++
    } catch (error) {
      logger.error('luogu_archiver_sync_submission_error', error as Error, {
        action: 'sync_submission',
        metadata: { recordId: sub.recordId }
      })
    }
  }

  const result: SyncResult = {
    count,
    total: submissions.length,
    skipped: existingIds.size,
  }

  logger.info('luogu_archiver_sync_complete', {
    action: 'sync_luogu_submissions',
    userId,
    metadata: result,
  })

  return result
}

/**
 * 归档洛谷 AC 题目到 UserArchivedProblem 表
 *
 * @param userId - 用户 ID
 * @param uid - 洛谷用户 ID（可省略，从绑定数据获取）
 * @param options - 过滤选项
 * @returns 归档结果
 */
export async function archiveLuoguProblemsForUser(
  userId: string,
  uid?: string,
  options?: ArchiveOptions
): Promise<{ count: number; total: number; skipped: number; problems: string[] }> {
  // 1. 创建 session
  const session = await LuoguSession.fromBinding(userId)
  if (!session) {
    logger.error('luogu_archiver_session_failed', undefined, {
      action: 'archive_luogu_problems',
      metadata: { userId }
    })
    return { count: 0, total: 0, skipped: 0, problems: [] }
  }

  // 2. 获取绑定数据中的 uid
  const binding = await prisma.userPlatformBinding.findUnique({
    where: { userId_platform: { userId, platform: 'luogu' } }
  })
  const bindingData = binding?.bindingData ? JSON.parse(binding.bindingData) : {}
  const uidCookie = bindingData.uidCookie || bindingData.uid || uid || session.getUid()

  // 3. 获取提交记录（只取 AC）
  const submissions = await fetchLuoguSubmissions(session, uidCookie, options)
  const acSubmissions = submissions.filter(s => s.result === 'accepted' || s.score >= 100)

  // 4. 去重
  const existingArchived = await prisma.userArchivedProblem.findMany({
    where: {
      userId,
      platform: 'luogu',
      problemId: { in: acSubmissions.map(s => s.problemId) },
    },
    select: { problemId: true },
  })
  const existingIds = new Set(existingArchived.map(a => a.problemId))

  // 5. 批量归档
  let count = 0
  const problems: string[] = []

  for (const sub of acSubmissions) {
    if (existingIds.has(sub.problemId)) continue

    try {
      await prisma.userArchivedProblem.create({
        data: {
          id: `${userId}_luogu_${sub.problemId}`,
          userId,
          platform: 'luogu',
          problemId: sub.problemId,
          ojRemoteId: sub.recordId,
          result: 'accepted',
          title: sub.problemId, // 洛谷题目标题需要额外获取
          submittedAt: sub.submittedAt,
          solvedAt: sub.submittedAt,
          sourceUrl: `${LUOGU_BASE}/problem/${sub.problemId}`,
        },
      })
      count++
      problems.push(sub.problemId)
    } catch (error) {
      logger.error('luogu_archiver_archive_problem_error', error as Error, {
        action: 'archive_problem',
        metadata: { problemId: sub.problemId }
      })
    }
  }

  const result = {
    count,
    total: acSubmissions.length,
    skipped: existingIds.size,
    problems,
  }

  logger.info('luogu_archiver_archive_complete', {
    action: 'archive_luogu_problems',
    userId,
    metadata: result,
  })

  return result
}

/**
 * 创建临时 LuoguSession（用于测试，不依赖数据库绑定）
 */
export function createLuoguSessionFromCookie(clientId: string, uidCookie: string): LuoguSession {
  // 使用反射绕过私有构造函数（仅用于测试）
  const SessionClass = LuoguSession as any
  return new SessionClass(clientId, uidCookie)
}