/**
 * Codeforces Problem Archiver
 * Codeforces 题目归档抓取逻辑
 *
 * 功能：从 Codeforces 抓取用户已解决的题目列表，并归档到本地
 */

import { chromium, Browser, Page } from 'playwright'
import { prisma } from '../../../prisma'
import logger from '../../../lib/logger'
import type { PlaywrightCookie } from '../../../lib/playwright-helper'
import { normalizeResult, ResultEnum } from '../../../lib/result-enum'

/**
 * 构建 CF Cookie
 */
function buildCfCookies(jsessionid: string): PlaywrightCookie[] {
  return [
    {
      name: 'JSESSIONID',
      value: jsessionid,
      domain: 'codeforces.com',
      path: '/',
    },
  ]
}

/**
 * CF 题目信息
 */
interface CfProblemInfo {
  contestId: string
  index: string
  problemId: string  // 如 "1669H"
  title: string
  rating?: number
  tags: string[]
  submissionId?: string  // CF submission id
  submittedAt?: Date
  programmingLanguage?: string
  solvedAt?: Date
}

/**
 * CF 提交记录（完整）
 */
interface CfSubmissionRecord {
  submissionId: string        // CF submission id
  problemId: string           // 如 "1669H"
  verdict: string             // OK, WRONG_ANSWER, TIME_LIMIT_EXCEEDED 等
  submittedAt: Date
  programmingLanguage: string
  timeUsed: number            // ms
  memoryUsed: number          // bytes
}

/**
 * 同步结果
 */
interface SyncResult {
  count: number       // 新同步数量
  total: number       // 本次抓取到的提交总数
  skipped: number     // 已存在跳过的数量
}

/**
 * 通过 CF API 获取用户所有提交记录
 *
 * @param handle - CF 用户名
 * @param options - 同步选项（时间范围过滤、单题过滤）
 * @returns 提交记录列表
 */
export async function fetchCfAllSubmissions(
  handle: string,
  options?: ArchiveOptions
): Promise<CfSubmissionRecord[]> {
  const submissions: CfSubmissionRecord[] = []
  // 单题同步：不限制页数，获取该题所有提交
  // 批量同步：限制10页（最近1000条提交）
  const maxPages = options?.problemId ? Infinity : 10
  const count = 100
  let page = 0

  while (page < maxPages) {
    const from = page * count + 1
    const url = `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=${from}&count=${count}`

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
      const data = await response.json()

      if (data.status !== 'OK' || !data.result?.length) break

      for (const sub of data.result) {
        // 只处理有 verdict 的提交（跳过正在评测的）
        if (!sub.verdict) continue

        const problemId = `${sub.problem.contestId}${sub.problem.index}`

        // 如果指定了 problemId，只处理该题
        if (options?.problemId && problemId !== options.problemId) continue

        // 时间范围过滤
        if (options?.startTime || options?.endTime) {
          const submittedAt = new Date(sub.creationTimeSeconds * 1000)
          if (options.startTime && submittedAt < options.startTime) continue
          if (options.endTime && submittedAt > options.endTime) continue
        }

        submissions.push({
          submissionId: String(sub.id),
          problemId,
          verdict: sub.verdict,
          submittedAt: new Date(sub.creationTimeSeconds * 1000),
          programmingLanguage: sub.programmingLanguage || 'unknown',
          timeUsed: sub.timeConsumedMillis || 0,
          memoryUsed: sub.memoryConsumedBytes || 0,
        })
      }

      // 如果返回数量小于 count，说明没有更多了
      if (data.result.length < count) break

      page++

    } catch (error) {
      logger.error('cf_api_fetch_submissions_error', error as Error, { action: 'fetch_cf_submissions' })
      break
    }
  }

  return submissions
}

/**
 * 同步 CF 提交记录到 Submission 表
 *
 * @param userId - 用户 ID
 * @param handle - CF 用户名
 * @param options - 同步选项
 * @returns 同步结果
 */
export async function syncCfSubmissionsForUser(
  userId: string,
  handle: string,
  options?: ArchiveOptions
): Promise<SyncResult> {
  // 1. 获取所有提交记录
  const submissions = await fetchCfAllSubmissions(handle, options)

  // 2. 查询已存在的提交（通过 ojRemoteId 去重）
  const existingSubmissions = await prisma.submission.findMany({
    where: {
      userId,
      oj: 'codeforces',
      ojRemoteId: { in: submissions.map(s => s.submissionId) },
    },
    select: { ojRemoteId: true },
  })
  const existingIds = new Set(existingSubmissions.map(s => s.ojRemoteId))

  // 3. 批量创建新提交记录
  let count = 0
  for (const sub of submissions) {
    // 跳过已存在的提交
    if (existingIds.has(sub.submissionId)) {
      continue
    }

    try {
      const problemRecord = await prisma.problem.findFirst({
        where: { platform: 'codeforces', problemId: sub.problemId },
      })

      await prisma.submission.create({
        data: {
          userId,
          oj: 'codeforces',
          ojRemoteId: sub.submissionId,
          problemId: sub.problemId,  // 外部题号
          problemInternalId: problemRecord?.id || null,
          result: normalizeResult(sub.verdict),
          language: sub.programmingLanguage,
          timeUsed: sub.timeUsed,
          memoryUsed: Math.floor(sub.memoryUsed / 1024), // bytes → KB
          createdAt: sub.submittedAt,
          submitScope: 'problem',
          code: '',  // CF API 不返回源代码，设为空字符串
          codeLength: 0,
          submitMethod: 'archive',
          // 补充缺失字段
          score: sub.verdict === 'OK' ? 100 : 0,
          isGlobalVisible: true,
          // 归档提交不设置 ojAccountId（该字段引用 OjAccount 表，不是 UserPlatformBinding）
        },
      })
      count++
    } catch (error) {
      // 唯一约束冲突（并发场景），忽略
      logger.error('cf_sync_submission_error', error as Error, {
        action: 'sync_submission',
        metadata: { submissionId: sub.submissionId },
      })
    }
  }

  const result: SyncResult = {
    count,                           // 新同步数量
    total: submissions.length,       // 本次抓取到的提交总数
    skipped: existingIds.size,       // 已存在跳过的数量
  }

  logger.info('cf_sync_complete', {
    action: 'sync_cf_submissions',
    userId,
    metadata: result,
  })

  return result
}

/**
 * CF 提交记录
 */
interface CfSubmissionInfo {
  submissionId: string
  problemId: string
  verdict: string
  submittedAt: string
}

/**
 * 归档选项
 */
interface ArchiveOptions {
  startTime?: Date    // 可选：开始时间（比赛/训练归档时传入）
  endTime?: Date      // 可选：结束时间（比赛/训练归档时传入）
  problemId?: string  // 可选：单题归档时传入
}

/**
 * 归档结果
 */
interface ArchiveResult {
  count: number       // 新归档数量
  total: number       // 用户在该平台总 AC 数
  skipped: number     // 已归档跳过的数量
  problems: CfProblemInfo[]
}

/**
 * 通过 CF API 获取用户已解决的题目列表
 *
 * @param handle - CF 用户名
 * @param options - 归档选项（时间范围过滤、单题过滤）
 * @returns 已解决的题目列表
 */
export async function fetchCfSolvedProblemsByApi(
  handle: string,
  options?: ArchiveOptions
): Promise<CfProblemInfo[]> {
  const problems: CfProblemInfo[] = []
  const maxPages = 10 // 最多查 10 页，即最近 1000 条提交
  const count = 100

  for (let page = 0; page < maxPages; page++) {
    const from = page * count + 1
    const url = `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=${from}&count=${count}`

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
      const data = await response.json()

      if (data.status !== 'OK' || !data.result?.length) break

      for (const sub of data.result) {
        // 只处理 AC
        if (sub.verdict !== 'OK') continue

        const problemId = `${sub.problem.contestId}${sub.problem.index}`

        // 如果指定了 problemId，只处理该题
        if (options?.problemId && problemId !== options.problemId) continue

        // 时间范围过滤
        if (options?.startTime || options?.endTime) {
          const submittedAt = new Date(sub.creationTimeSeconds * 1000)
          if (options.startTime && submittedAt < options.startTime) continue
          if (options.endTime && submittedAt > options.endTime) continue
        }

        problems.push({
          contestId: String(sub.problem.contestId),
          index: sub.problem.index,
          problemId,
          title: sub.problem.name || '',
          rating: sub.problem.rating,
          tags: sub.problem.tags || [],
          submissionId: String(sub.id),
          submittedAt: new Date(sub.creationTimeSeconds * 1000),
          programmingLanguage: sub.programmingLanguage,
        })

        // 如果指定了 problemId 且已找到，可以提前退出
        if (options?.problemId) break
      }

      // 如果返回数量小于 count，说明没有更多了
      if (data.result.length < count) break

    } catch (error) {
      logger.error('cf_api_fetch_error', error as Error, { action: 'fetch_cf_solved_api' })
      break
    }
  }

  return problems
}

/**
 * 从 Codeforces 抓取用户已解决的题目列表（Playwright 方式，作为备用）
 *
 * @param jsessionid - 用户绑定的 JSESSIONID
 * @param handle - CF 用户名
 * @param options - 归档选项（时间范围过滤）
 * @returns 已解决的题目列表
 */
export async function fetchCfSolvedProblems(
  jsessionid: string,
  handle: string,
  options?: ArchiveOptions
): Promise<CfProblemInfo[]> {
  // 优先使用 API 方式
  try {
    const apiProblems = await fetchCfSolvedProblemsByApi(handle, options)
    if (apiProblems.length > 0) {
      return apiProblems
    }
  } catch (apiError) {
    logger.warn('cf_archiver_api_failed_fallback_playwright', {
      action: 'fetch_cf_solved',
      metadata: { error: (apiError as Error).message }
    })
  }

  // API 失败时回退到 Playwright
  const cookies = buildCfCookies(jsessionid)
  const problems: CfProblemInfo[] = []
  let browser: Browser | null = null

  try {
    logger.info('cf_archiver_start', {
      action: 'fetch_cf_solved',
      metadata: { handle },
    })

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    })

    await context.addCookies(cookies)
    const page = await context.newPage()

    // 访问用户提交页面
    const submissionsUrl = `https://codeforces.com/submissions/${handle}`
    logger.info('cf_archiver_navigating', { action: 'fetch_cf_solved', metadata: { url: submissionsUrl } })

    await page.goto(submissionsUrl, {
      timeout: 30000,
      waitUntil: 'domcontentloaded',
    })

    // 等待 Cloudflare challenge
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

    // 解析提交记录
    const submissions = await parseSubmissionsPage(page)
    logger.info('cf_archiver_parsed', {
      action: 'fetch_cf_solved',
      metadata: { submissionCount: submissions.length },
    })

    // 去重：只保留 AC 的题目
    const acProblems = new Map<string, CfProblemInfo>()
    for (const sub of submissions) {
      if (sub.verdict === 'Accepted' && sub.problemId) {
        // 时间范围过滤（比赛/训练归档时）
        if (options?.startTime || options?.endTime) {
          const submittedAt = sub.submittedAt ? parseCfTime(sub.submittedAt) : null
          if (submittedAt) {
            if (options.startTime && submittedAt < options.startTime) continue
            if (options.endTime && submittedAt > options.endTime) continue
          }
        }

        // 单题过滤
        if (options?.problemId && sub.problemId !== options.problemId) continue

        if (!acProblems.has(sub.problemId)) {
          const parsedTime = sub.submittedAt ? parseCfTime(sub.submittedAt) : undefined
          acProblems.set(sub.problemId, {
            contestId: sub.problemId.replace(/[A-Z]\d*$/, ''),
            index: sub.problemId.match(/[A-Z]\d*$/)?.[0] || '',
            problemId: sub.problemId,
            title: '',  // 标题需要单独获取
            tags: [],
            submissionId: sub.submissionId,
            solvedAt: parsedTime || undefined,
          })
        }
      }
    }

    // 获取题目详情（标题、rating、tags）
    const problemList = Array.from(acProblems.values())

    // 批量获取题目信息（可选，API 方式更快）
    await enrichProblemDetails(page, problemList)

    return problemList

  } catch (error) {
    logger.error('cf_archiver_error', error as Error, {
      action: 'fetch_cf_solved',
    })
    throw error
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

/**
 * 解析 CF 时间格式
 * 如 "Jan/01/2024 12:34" -> Date
 */
function parseCfTime(timeStr: string): Date | null {
  try {
    // CF 时间格式：Jan/01/2024 12:34
    const match = timeStr.match(/(\w{3})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/)
    if (match) {
      const [, month, day, year, hour, minute] = match
      const months: Record<string, number> = {
        Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
        Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
      }
      return new Date(
        parseInt(year),
        months[month] || 0,
        parseInt(day),
        parseInt(hour),
        parseInt(minute)
      )
    }
    return null
  } catch {
    return null
  }
}

/**
 * 解析提交记录页面
 */
async function parseSubmissionsPage(page: Page): Promise<CfSubmissionInfo[]> {
  const submissions: CfSubmissionInfo[] = []

  try {
    // 等待表格加载
    await page.waitForSelector('table.status-frame-datatable', { timeout: 10000 })

    // 获取所有行
    const rows = await page.$$('table.status-frame-datatable tbody tr')

    for (const row of rows) {
      try {
        // 提取题号
        const problemLink = await row.$('td:nth-child(4) a')
        if (!problemLink) continue

        const problemHref = await problemLink.getAttribute('href')
        if (!problemHref) continue

        // 解析题号：/contest/1669/problem/H -> 1669H
        const problemMatch = problemHref.match(/\/contest\/(\d+)\/problem\/([A-Z]\d*)/)
        if (!problemMatch) continue

        const problemId = problemMatch[1] + problemMatch[2]

        // 提取评测结果
        const verdictCell = await row.$('td:nth-child(6)')
        const verdict = await verdictCell?.textContent() || ''
        const isAccepted = verdict.includes('Accepted')

        // 提交时间
        const timeCell = await row.$('td:nth-child(2)')
        const submittedAt = await timeCell?.textContent() || ''

        submissions.push({
          submissionId: await row.getAttribute('data-submission-id') || '',
          problemId,
          verdict: isAccepted ? 'Accepted' : verdict.trim(),
          submittedAt: submittedAt.trim(),
        })

      } catch (rowError) {
        // 单行解析失败，继续处理其他行
        continue
      }
    }

    // 检查是否有分页，需要翻页获取更多数据
    const hasNextPage = await page.$('div.pagination ul li:nth-last-child(2) a')
    if (hasNextPage) {
      // TODO: 实现分页抓取（当前只抓取第一页）
      logger.info('cf_archiver_has_more_pages', {
        action: 'parse_submissions',
        metadata: { message: 'More pages available, only first page fetched' },
      })
    }

  } catch (error) {
    logger.error('cf_archiver_parse_error', error as Error)
  }

  return submissions
}

/**
 * 通过 CF API 获取题目详情
 */
async function enrichProblemDetails(page: Page, problems: CfProblemInfo[]): Promise<void> {
  // 使用 CF API 批量获取题目信息
  const problemIds = problems.map(p => p.problemId)

  // CF API 每次最多查询 10000 个题目，这里分批处理
  const batchSize = 100
  for (let i = 0; i < problemIds.length; i += batchSize) {
    const batch = problemIds.slice(i, i + batchSize)

    try {
      // 解析 contestId 和 index
      const handles = batch.map(id => {
        const match = id.match(/^(\d+)([A-Z]\d*)$/)
        return match ? { contestId: match[1], index: match[2] } : null
      }).filter(Boolean) as Array<{ contestId: string; index: string }>

      // 调用 CF API
      // 注意：CF API 没有 batch 接口，需要逐个查询或使用 contest.standings
      // 这里简化处理，只获取已知的题目信息

      for (const problem of problems) {
        if (!problem.problemId) continue

        // 尝试从题目页面获取详情
        try {
          const { contestId, index } = problem
          const problemUrl = `https://codeforces.com/problemset/problem/${contestId}/${index}`

          // 使用 API 获取题目信息
          const apiUrl = `https://codeforces.com/api/contest.standings?contestId=${contestId}&from=1&count=1`
          const response = await fetch(apiUrl)

          if (response.ok) {
            const data = await response.json()
            if (data.status === 'OK' && data.result?.problems) {
              const problemData = data.result.problems.find((p: any) => p.index === index)
              if (problemData) {
                problem.title = problemData.name || ''
                problem.rating = problemData.rating
                problem.tags = problemData.tags || []
              }
            }
          }
        } catch {
          // 单个题目获取失败，跳过
        }
      }

    } catch (error) {
      logger.error('cf_archiver_enrich_error', error as Error)
    }
  }
}

/**
 * 将 CF 题目归档到用户账号
 *
 * @param userId - 用户 ID
 * @param jsessionid - CF JSESSIONID
 * @param handle - CF 用户名
 * @param options - 归档选项（时间范围过滤）
 * @returns 归档结果
 */
export async function archiveCfProblemsForUser(
  userId: string,
  jsessionid: string,
  handle: string,
  options?: ArchiveOptions
): Promise<ArchiveResult> {
  // 1. 抓取已解决的题目
  const problems = await fetchCfSolvedProblems(jsessionid, handle, options)

  // 2. 查询已归档的题目（去重）
  const existingArchived = await prisma.userArchivedProblem.findMany({
    where: {
      userId,
      platform: 'codeforces',
      problemId: { in: problems.map(p => p.problemId) },
    },
    select: { problemId: true },
  })
  const existingIds = new Set(existingArchived.map(a => a.problemId))

  // 3. 批量归档新题目
  let count = 0
  for (const problem of problems) {
    // 跳过已归档的题目
    if (existingIds.has(problem.problemId)) {
      continue
    }

    try {
      await prisma.userArchivedProblem.create({
        data: {
          id: `${userId}_codeforces_${problem.problemId}`,
          userId,
          platform: 'codeforces',
          problemId: problem.problemId,
          ojRemoteId: problem.submissionId || problem.solvedAt?.getTime()?.toString(), // 真正的 submission id
          result: 'accepted',
          title: problem.title || problem.problemId,
          difficulty: problem.rating?.toString(),
          tags: problem.tags.length > 0 ? JSON.stringify(problem.tags) : null,
          submittedAt: problem.submittedAt || problem.solvedAt,
          solvedAt: problem.solvedAt || problem.submittedAt,
          sourceUrl: `https://codeforces.com/problemset/problem/${problem.contestId}/${problem.index}`,
        },
      })
      count++
    } catch (error) {
      // 唯一约束冲突（并发场景），忽略
      logger.error('cf_archiver_save_error', error as Error, {
        action: 'archive_problem',
        metadata: { problemId: problem.problemId },
      })
    }
  }

  const result: ArchiveResult = {
    count,                           // 新归档数量
    total: problems.length,          // 本次抓取到的 AC 数
    skipped: existingIds.size,       // 已归档跳过的数量
    problems,
  }

  logger.info('cf_archiver_complete', {
    action: 'archive_cf_problems',
    userId,
    metadata: result,
  })

  return result
}
