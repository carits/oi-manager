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
import { normalizeResult, ResultEnum } from '../../../lib/result-enum'

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
 * 洛谷评测结果状态码映射
 * 洛谷使用数字状态码，需要转换为字符串
 */
const LUOGU_STATUS_CODE_MAP: Record<number, string> = {
  0: 'queuing',
  1: 'judging',
  2: 'ce',       // compilation_error
  3: 'ole',      // output_limit_exceeded
  4: 'mle',      // memory_limit_exceeded
  5: 'tle',      // time_limit_exceeded
  6: 'wa',       // wrong_answer
  7: 're',       // runtime_error
  8: 'accepted',
  9: 'hacked',   // hack_successful
  10: 'hacked',  // hack_unsuccessful
  11: 'queuing', // judging (pending)
  12: 'accepted', // accepted with full score
  14: 'wa',      // unaccepted（部分通过）→ 用户确认映射为 wa
}

/**
 * 洛谷语言 ID 映射
 * 洛谷使用数字 ID 表示语言，需要转换为字符串
 * 保留 O2 信息以区分不同版本
 */
const LUOGU_LANGUAGE_ID_MAP: Record<number, string> = {
  1: 'pascal',
  2: 'c',
  3: 'cpp98',
  4: 'cpp11',
  7: 'python3',
  8: 'java8',
  9: 'nodejs',
  11: 'cpp14',
  12: 'cpp17',
  13: 'ruby',
  14: 'go',
  15: 'rust',
  16: 'php',
  17: 'csharp_mono',
  19: 'haskell',
  21: 'kotlin',
  22: 'scala',
  23: 'perl',
  27: 'cpp20',
  28: 'cpp14_gcc9',
  30: 'ocaml',
  31: 'julia',
  32: 'lua',
  33: 'java21',
  34: 'cpp23',
}

/**
 * 转换洛谷语言 ID 为字符串
 */
function convertLuoguLanguage(languageId: number | string): string {
  if (typeof languageId === 'string') return languageId
  return LUOGU_LANGUAGE_ID_MAP[languageId] || `luogu_lang_${languageId}`
}

/**
 * 从提交记录列表页面获取某题的所有提交
 *
 * 使用 /record/list API（洛谷正确的 API 端点）
 * 可以获取用户对某题的全部提交（包括 WA/TLE 等失败提交）
 *
 * @param session - LuoguSession 实例
 * @param problemId - 题号
 * @param uid - 用户 ID
 * @returns 所有提交记录（包括 AC 和未满分提交）
 */
async function fetchAllSubmissionsForProblem(
  session: LuoguSession,
  problemId: string,
  uid: string
): Promise<LuoguSubmissionRecord[]> {
  const submissions: LuoguSubmissionRecord[] = []

  // 使用 /record/list API（正确的 API 端点）
  // 分页获取用户对该题的所有提交
  let page = 1

  logger.info('luogu_archiver_record_list_request', {
    action: 'fetch_all_submissions_for_problem',
    metadata: { problemId, uid, note: '使用 /record/list API 获取全部提交' }
  })

  try {
    while (true) {
      const url = `${LUOGU_BASE}/record/list?user=${uid}&pid=${problemId}&page=${page}`
      const html = await session.fetchPageContent(url)
      const data = session.parsePageData(html)

      // 数据在 currentData.records.result（_feInjection 格式）
      const records = data?.currentData?.records?.result || data?.data?.records?.result || data?.records?.result || []

      if (records.length === 0) break

      for (const record of records) {
        // 直接解析记录（不再是 item.submission 结构）
        const statusCode = record.status ?? 0
        const result = LUOGU_STATUS_CODE_MAP[statusCode] || 'unknown'

        submissions.push({
          recordId: String(record.id),
          problemId: record.problem?.pid || problemId,
          result,
          score: record.score ?? 0,
          language: record.language || 0,
          timeUsed: record.time || 0,
          memoryUsed: record.memory || 0,
          submittedAt: record.submitTime ? new Date(record.submitTime * 1000) : new Date(),
        })
      }

      // 分页检查：perPage=20，如果返回少于 20 条说明最后一页
      const totalCount = data?.currentData?.records?.count || data?.data?.records?.count || 0
      if (records.length < 20 || submissions.length >= totalCount) break
      page++
    }

    logger.info('luogu_archiver_record_list_success', {
      action: 'fetch_all_submissions_for_problem',
      metadata: { problemId, uid, count: submissions.length, pages: page }
    })

  } catch (err) {
    logger.error('luogu_archiver_record_list_failed', err as Error, {
      action: 'fetch_all_submissions_for_problem',
      metadata: { problemId, uid }
    })
  }

  return submissions
}

/**
 * 从提交记录列表获取所有提交（批量归档，分页）
 * 使用 /record/list API（正确的 API 端点）
 *
 * @param session - LuoguSession 实例
 * @param uid - 用户 ID
 * @param options - 过滤选项
 * @returns 所有提交记录
 */
async function fetchAllUserSubmissions(
  session: LuoguSession,
  uid: string,
  options?: ArchiveOptions
): Promise<LuoguSubmissionRecord[]> {
  const submissions: LuoguSubmissionRecord[] = []
  let page = 1

  logger.info('luogu_archiver_record_list_request', {
    action: 'fetch_all_user_submissions',
    metadata: { uid, note: '使用 /record/list API 获取全部提交' }
  })

  try {
    while (true) {
      const url = `${LUOGU_BASE}/record/list?user=${uid}&page=${page}`
      const html = await session.fetchPageContent(url)
      const data = session.parsePageData(html)

      // 数据在 currentData.records.result（_feInjection 格式）
      const records = data?.currentData?.records?.result || data?.data?.records?.result || data?.records?.result || []

      if (records.length === 0) break

      for (const record of records) {
        // 时间范围过滤
        const submittedAt = record.submitTime ? new Date(record.submitTime * 1000) : new Date()
        if (options?.startTime && submittedAt < options.startTime) continue
        if (options?.endTime && submittedAt > options.endTime) continue

        // 直接解析记录（不再是 item.submission 结构）
        const statusCode = record.status ?? 0
        const result = LUOGU_STATUS_CODE_MAP[statusCode] || 'unknown'

        submissions.push({
          recordId: String(record.id),
          problemId: record.problem?.pid || '',
          result,
          score: record.score ?? 0,
          language: record.language || 0,
          timeUsed: record.time || 0,
          memoryUsed: record.memory || 0,
          submittedAt,
        })
      }

      // 分页检查：perPage=20，如果返回少于 20 条说明最后一页
      const totalCount = data?.currentData?.records?.count || data?.data?.records?.count || 0
      if (records.length < 20 || submissions.length >= totalCount) break
      page++
    }

    logger.info('luogu_archiver_record_list_success', {
      action: 'fetch_all_user_submissions',
      metadata: { uid, count: submissions.length, pages: page }
    })

  } catch (err) {
    logger.error('luogu_archiver_record_list_failed', err as Error, {
      action: 'fetch_all_user_submissions',
      metadata: { uid }
    })
  }

  return submissions
}

/**
 * 从题目页面获取用户对该题的最佳提交记录
 * 洛谷用户提交 API 返回 404，需要通过题目页面获取 bestRecord
 *
 * @param session - LuoguSession 实例
 * @param problemId - 题号（如 P4156）
 * @returns 提交记录（bestRecord）
 */
async function fetchUserSubmissionFromProblemPage(
  session: LuoguSession,
  problemId: string
): Promise<LuoguSubmissionRecord | null> {
  const problemUrl = `${LUOGU_BASE}/problem/${problemId}`

  try {
    const html = await session.fetchPageContent(problemUrl)
    const data = session.parsePageData(html)

    // 从题目页面获取 bestRecord
    const bestRecord = data?.data?.problem?.bestRecord

    if (!bestRecord || !bestRecord.id) {
      logger.info('luogu_archiver_no_best_record', {
        action: 'fetch_from_problem_page',
        metadata: { problemId }
      })
      return null
    }

    // 转换状态码
    const statusCode = bestRecord.status ?? 0
    const result = LUOGU_STATUS_CODE_MAP[statusCode] || 'unknown'

    return {
      recordId: String(bestRecord.id),
      problemId,
      result,
      score: bestRecord.score ?? 0,
      language: 'unknown', // bestRecord 不包含语言，需要从详情获取
      timeUsed: 0, // bestRecord 不包含耗时，需要从详情获取
      memoryUsed: 0, // bestRecord 不包含内存，需要从详情获取
      submittedAt: new Date(), // bestRecord 不包含时间，需要从详情获取
    }
  } catch (err) {
    logger.error('luogu_archiver_problem_page_failed', err as Error, {
      action: 'fetch_from_problem_page',
      metadata: { problemId }
    })
    return null
  }
}

/**
 * 获取用户对某题的提交记录
 *
 * 策略：
 * 1. 如果指定了 problemId，从提交记录页面获取该题所有提交
 * 2. 否则从用户提交页面分页获取所有提交
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
  // 策略 1：单题归档 - 从提交记录页面获取该题所有提交
  if (options?.problemId) {
    const records = await fetchAllSubmissionsForProblem(session, options.problemId, uid)
    logger.info('luogu_archiver_single_problem_complete', {
      action: 'fetch_luogu_submissions',
      metadata: { uid, problemId: options.problemId, count: records.length }
    })
    return records
  }

  // 策略 2：批量归档 - 从用户提交页面分页获取所有提交
  const records = await fetchAllUserSubmissions(session, uid, options)
  logger.info('luogu_archiver_batch_complete', {
    action: 'fetch_luogu_submissions',
    metadata: { uid, count: records.length }
  })
  return records
}

/**
 * 获取提交详情（含源代码、耗时、内存等）
 *
 * @param session - LuoguSession 实例
 * @param recordId - 提交 ID
 * @returns 提交详情（含代码、语言、耗时、内存）
 */
export async function fetchLuoguRecordDetail(
  session: LuoguSession,
  recordId: string
): Promise<{
  code: string
  language: string
  timeUsed: number
  memoryUsed: number
  submittedAt: Date
  detail: any
} | null> {
  const recordUrl = `${LUOGU_BASE}/record/${recordId}`

  try {
    const html = await session.fetchPageContent(recordUrl)
    const data = session.parsePageData(html)

    // 洛谷提交详情数据结构：data.record
    const record = data?.data?.record || data?.record

    if (!record) {
      logger.warn('luogu_archiver_no_record_data', {
        action: 'fetch_luogu_record_detail',
        metadata: { recordId }
      })
      return null
    }

    // 提取完整数据
    const code = record.sourceCode || ''
    const language = record.language || 'unknown'
    const timeUsed = record.time || 0
    const memoryUsed = record.memory || 0
    const submittedAt = record.submitTime ? new Date(record.submitTime * 1000) : new Date()

    logger.info('luogu_archiver_record_detail_success', {
      action: 'fetch_luogu_record_detail',
      metadata: { recordId, language, codeLength: code.length, timeUsed, memoryUsed }
    })

    return {
      code,
      language,
      timeUsed,
      memoryUsed,
      submittedAt,
      detail: record.detail || {}
    }
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
 * @returns 同步结果
 */
export async function syncLuoguSubmissionsForUser(
  userId: string,
  uid?: string,
  options?: ArchiveOptions
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

  // 调试：输出绑定数据关键字段
  logger.info('luogu_archiver_binding_data_check', {
    action: 'sync_luogu_submissions',
    metadata: {
      userId,
      hasClientId: !!bindingData.clientId,
      hasUidCookie: !!bindingData.uidCookie,
      hasUid: !!bindingData.uid,
      uidCookieValue: bindingData.uidCookie ? '存在' : '不存在',
      uidValue: bindingData.uid ? '存在' : '不存在',
      finalUid: uidCookie || '空'
    }
  })

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
      // 获取完整提交详情（含代码、语言、耗时、内存、提交时间）
      const detail = await fetchLuoguRecordDetail(session, sub.recordId)

      // 使用详情数据覆盖 bestRecord 的默认值
      const code = detail?.code || ''
      const rawLanguage = detail?.language || sub.language || 0
      const language = convertLuoguLanguage(rawLanguage)
      const timeUsed = detail?.timeUsed || sub.timeUsed || 0
      const memoryUsed = detail?.memoryUsed || sub.memoryUsed || 0
      const submittedAt = detail?.submittedAt || sub.submittedAt

      const problemRecord = await prisma.problem.findFirst({
        where: { platform: 'luogu', problemId: sub.problemId },
      })

      await prisma.submission.create({
        data: {
          userId,
          oj: 'luogu',
          ojRemoteId: sub.recordId,
          problemId: sub.problemId,
          problemInternalId: problemRecord?.id || null,
          result: normalizeResult(sub.result),
          language,
          timeUsed,
          memoryUsed,
          createdAt: submittedAt,
          submitScope: 'problem',
          code,
          codeLength: code.length,
          submitMethod: 'archive',
          score: sub.score,
          isGlobalVisible: true,
          // 归档提交不设置 ojAccountId（该字段引用 OjAccount 表，不是 UserPlatformBinding）
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

/**
 * 快速同步第一条提交
 * 获取提交列表后，立即同步最新一条，返回给前端弹窗展示
 *
 * @param userId - 用户 ID
 * @param problemId - 题号
 * @returns 第一条 Submission 信息 + 待异步同步的提交列表
 */
export async function syncFirstLuoguSubmission(
  userId: string,
  problemId: string
): Promise<{
  firstSubmission: {
    id: string
    result: string
    score: number
    language: string
    code: string
    timeUsed: number
    memoryUsed: number
    submittedAt: Date
    ojRemoteId: string
    problemId: string
  } | null
  totalCount: number
  pendingCount: number
  pendingRecordIds: string[]
  skipped: number
}> {
  // 1. 查询绑定数据
  const binding = await prisma.userPlatformBinding.findUnique({
    where: { userId_platform: { userId, platform: 'luogu' } }
  })

  if (!binding || binding.bindingStatus !== 'bound' || !binding.bindingData) {
    logger.error('luogu_archiver_no_binding', undefined, {
      action: 'sync_first_luogu_submission',
      metadata: { userId }
    })
    return { firstSubmission: null, totalCount: 0, pendingCount: 0, pendingRecordIds: [], skipped: 0 }
  }

  const bindingData = JSON.parse(binding.bindingData)
  const clientId = bindingData.clientId
  const uidCookie = bindingData.uidCookie || bindingData.uid

  if (!clientId || !uidCookie) {
    logger.error('luogu_archiver_binding_data_missing', undefined, {
      action: 'sync_first_luogu_submission',
      metadata: { userId }
    })
    return { firstSubmission: null, totalCount: 0, pendingCount: 0, pendingRecordIds: [], skipped: 0 }
  }

  // 2. 创建 session
  const session = await LuoguSession.fromBinding(userId)
  if (!session) {
    logger.error('luogu_archiver_session_failed', undefined, {
      action: 'sync_first_luogu_submission',
      metadata: { userId }
    })
    return { firstSubmission: null, totalCount: 0, pendingCount: 0, pendingRecordIds: [], skipped: 0 }
  }

  // 3. 获取提交列表
  const submissions = await fetchLuoguSubmissions(session, uidCookie, { problemId })

  if (submissions.length === 0) {
    logger.info('luogu_archiver_no_submissions', {
      action: 'sync_first_luogu_submission',
      metadata: { userId, problemId }
    })
    return { firstSubmission: null, totalCount: 0, pendingCount: 0, pendingRecordIds: [], skipped: 0 }
  }

  // 4. 查询已存在的提交（去重）
  const existingSubmissions = await prisma.submission.findMany({
    where: {
      userId,
      oj: 'luogu',
      ojRemoteId: { in: submissions.map(s => s.recordId) },
    },
    select: { ojRemoteId: true },
  })
  const existingIds = new Set(existingSubmissions.map(s => s.ojRemoteId))

  // 5. 按时间排序，找到最新一条新提交
  const newSubmissions = submissions
    .filter(s => !existingIds.has(s.recordId))
    .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())

  if (newSubmissions.length === 0) {
    // 所有提交都已存在
    return {
      firstSubmission: null,
      totalCount: submissions.length,
      pendingCount: 0,
      pendingRecordIds: [],
      skipped: existingIds.size
    }
  }

  // 6. 同步最新一条
  const latestSub = newSubmissions[0]

  try {
    // 获取详情
    const detail = await fetchLuoguRecordDetail(session, latestSub.recordId)

    const code = detail?.code || ''
    const rawLanguage = detail?.language || latestSub.language || 0
    const language = convertLuoguLanguage(rawLanguage)
    const timeUsed = detail?.timeUsed || latestSub.timeUsed || 0
    const memoryUsed = detail?.memoryUsed || latestSub.memoryUsed || 0
    const submittedAt = detail?.submittedAt || latestSub.submittedAt

    const problemRecord = await prisma.problem.findFirst({
      where: { platform: 'luogu', problemId: latestSub.problemId },
    })

    // 创建 Submission
    const submission = await prisma.submission.create({
      data: {
        userId,
        oj: 'luogu',
        ojRemoteId: latestSub.recordId,
        problemId: latestSub.problemId,
        problemInternalId: problemRecord?.id || null,
        result: normalizeResult(latestSub.result),
        language,
        timeUsed,
        memoryUsed,
        createdAt: submittedAt,
        submitScope: 'problem',
        code,
        codeLength: code.length,
        submitMethod: 'archive',
        score: latestSub.score,
        isGlobalVisible: true,
      },
    })

    logger.info('luogu_archiver_first_sync_complete', {
      action: 'sync_first_luogu_submission',
      metadata: {
        userId,
        problemId,
        submissionId: submission.id,
        pendingCount: newSubmissions.length - 1
      }
    })

    // 7. 返回结果
    return {
      firstSubmission: {
        id: String(submission.id),
        result: submission.result,
        score: submission.score ?? 0,
        language: submission.language,
        code: submission.code ?? '',
        timeUsed: submission.timeUsed ?? 0,
        memoryUsed: submission.memoryUsed ?? 0,
        submittedAt: submission.createdAt,
        ojRemoteId: submission.ojRemoteId ?? '',
        problemId: submission.problemId
      },
      totalCount: submissions.length,
      pendingCount: newSubmissions.length - 1,
      pendingRecordIds: newSubmissions.slice(1).map(s => s.recordId),
      skipped: existingIds.size
    }
  } catch (error) {
    logger.error('luogu_archiver_first_sync_error', error as Error, {
      action: 'sync_first_luogu_submission',
      metadata: { recordId: latestSub.recordId }
    })
    return {
      firstSubmission: null,
      totalCount: submissions.length,
      pendingCount: newSubmissions.length,
      pendingRecordIds: newSubmissions.map(s => s.recordId),
      skipped: existingIds.size
    }
  }
}

/**
 * 异步同步剩余提交
 * fire-and-forget 模式，不阻塞响应
 *
 * @param userId - 用户 ID
 * @param problemId - 题号
 * @param pendingRecordIds - 待同步的提交 ID 列表
 */
export function startAsyncSyncRemaining(
  userId: string,
  problemId: string,
  pendingRecordIds: string[]
): void {
  // 不阻塞，后台执行
  asyncSyncRemaining(userId, problemId, pendingRecordIds).catch(err => {
    logger.error('luogu_archiver_async_sync_failed', err as Error, {
      action: 'async_sync_remaining',
      metadata: { userId, problemId, pendingCount: pendingRecordIds.length }
    })
  })
}

/**
 * 内部异步同步实现
 */
async function asyncSyncRemaining(
  userId: string,
  problemId: string,
  pendingRecordIds: string[]
): Promise<void> {
  if (pendingRecordIds.length === 0) return

  logger.info('luogu_archiver_async_sync_start', {
    action: 'async_sync_remaining',
    metadata: { userId, problemId, pendingCount: pendingRecordIds.length }
  })

  // 1. 创建 session
  const session = await LuoguSession.fromBinding(userId)
  if (!session) {
    logger.error('luogu_archiver_async_session_failed', undefined, {
      action: 'async_sync_remaining',
      metadata: { userId }
    })
    return
  }

  // 2. 逐个同步
  let syncedCount = 0

  for (const recordId of pendingRecordIds) {
    try {
      // 获取详情
      const detail = await fetchLuoguRecordDetail(session, recordId)

      // 从列表中获取基本信息（需要重新获取列表或缓存）
      // 这里简化处理：直接从详情中提取
      const recordUrl = `${LUOGU_BASE}/record/${recordId}`
      const html = await session.fetchPageContent(recordUrl)
      const data = session.parsePageData(html)
      const record = data?.data?.record || data?.record

      if (!record) {
        logger.warn('luogu_archiver_async_no_record', {
          action: 'async_sync_remaining',
          metadata: { recordId }
        })
        continue
      }

      const code = record.sourceCode || ''
      const rawLanguage = record.language || 0
      const language = convertLuoguLanguage(rawLanguage)
      const statusCode = record.status ?? 0
      const result = LUOGU_STATUS_CODE_MAP[statusCode] || 'unknown'
      const subProblemId = record.problem?.pid || problemId

      const problemRecord = await prisma.problem.findFirst({
        where: { platform: 'luogu', problemId: subProblemId },
      })

      // 创建 Submission
      await prisma.submission.create({
        data: {
          userId,
          oj: 'luogu',
          ojRemoteId: recordId,
          problemId: subProblemId,
          problemInternalId: problemRecord?.id || null,
          result: normalizeResult(result),
          language,
          timeUsed: record.time || 0,
          memoryUsed: record.memory || 0,
          createdAt: record.submitTime ? new Date(record.submitTime * 1000) : new Date(),
          submitScope: 'problem',
          code,
          codeLength: code.length,
          submitMethod: 'archive',
          score: record.score ?? 0,
          isGlobalVisible: true,
        },
      })

      syncedCount++

    } catch (error) {
      logger.error('luogu_archiver_async_sync_error', error as Error, {
        action: 'async_sync_remaining',
        metadata: { recordId }
      })
    }
  }

  logger.info('luogu_archiver_async_sync_complete', {
    action: 'async_sync_remaining',
    metadata: { userId, problemId, syncedCount, totalPending: pendingRecordIds.length }
  })
}