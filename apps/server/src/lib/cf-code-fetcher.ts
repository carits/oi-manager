/**
 * CF Submission Code Fetcher
 * 通过 Playwright 抓取 Codeforces 提交详情页获取源代码
 *
 * 策略：
 * 1. 优先使用 VJudge 代理服务器（自动处理 Cloudflare Turnstile）
 * 2. 代理失败时回退到直连 + JSESSIONID cookie
 */

import { chromium, Browser } from 'playwright'
import { prisma } from '../prisma'
import logger from './logger'

// VJudge 代理配置缓存
interface VjudgeProxyConfig {
  host: string
  portMin: number
  portMax: number
  username: string
  password: string
}

let cachedProxyConfig: VjudgeProxyConfig | null = null
let proxyConfigFetchedAt = 0
const PROXY_CONFIG_TTL = 10 * 60 * 1000 // 10 分钟缓存

/**
 * 从 VJudge 获取代理配置
 * VJudge Helper 扩展从 https://vjudge.net/cloudflare/helperConfig 获取代理列表
 */
async function getVjudgeProxyConfig(): Promise<VjudgeProxyConfig | null> {
  // 使用缓存
  if (cachedProxyConfig && Date.now() - proxyConfigFetchedAt < PROXY_CONFIG_TTL) {
    return cachedProxyConfig
  }

  try {
    const response = await fetch('https://vjudge.net/cloudflare/helperConfig', {
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      logger.warn('vjudge_proxy_config_fetch_failed', {
        action: 'cf_code_fetch',
        metadata: { status: response.status },
      })
      return cachedProxyConfig // 返回旧缓存
    }

    const config = await response.json()

    // VJudge 返回格式: { proxies: [{ host, portMin, portMax, username, password }] }
    if (config.proxies && Array.isArray(config.proxies) && config.proxies.length > 0) {
      // 选择第一个代理配置
      const proxy = config.proxies[0]
      cachedProxyConfig = {
        host: proxy.host,
        portMin: proxy.portMin || proxy.port,
        portMax: proxy.portMax || proxy.port,
        username: proxy.username || 'foo',
        password: proxy.password || 'bar',
      }
      proxyConfigFetchedAt = Date.now()

      logger.info('vjudge_proxy_config_loaded', {
        action: 'cf_code_fetch',
        metadata: { host: cachedProxyConfig.host, portRange: `${cachedProxyConfig.portMin}-${cachedProxyConfig.portMax}` },
      })

      return cachedProxyConfig
    }

    logger.warn('vjudge_proxy_config_invalid', {
      action: 'cf_code_fetch',
      metadata: { config },
    })
    return null
  } catch (error) {
    logger.warn('vjudge_proxy_config_error', {
      action: 'cf_code_fetch',
      metadata: { error: (error as Error).message },
    })
    return cachedProxyConfig // 返回旧缓存
  }
}

/**
 * 随机选择一个代理端口
 */
function selectProxyPort(config: VjudgeProxyConfig): number {
  const { portMin, portMax } = config
  return portMin + Math.floor(Math.random() * (portMax - portMin + 1))
}

/**
 * 从 CF 提交详情页抓取源代码
 * URL: https://codeforces.com/contest/{contestId}/submission/{submissionId}
 * @param contestId - 比赛 ID（从 problemId 提取）
 * @param submissionId - CF 远程提交 ID（ojRemoteId）
 * @param jsessionid - 用户绑定的 CF jsessionid cookie（可选，用于直连回退）
 */
export async function fetchCfSubmissionCode(
  contestId: string,
  submissionId: string,
  jsessionid?: string
): Promise<{ code: string; codeLength: number } | null> {
  // 策略 1：使用 VJudge 代理
  const proxyConfig = await getVjudgeProxyConfig()
  if (proxyConfig) {
    const result = await fetchWithProxy(contestId, submissionId, proxyConfig)
    if (result) return result
    logger.info('cf_code_fetch_proxy_failed_trying_direct', {
      action: 'cf_code_fetch',
      metadata: { contestId, submissionId },
    })
  }

  // 策略 2：直连 + JSESSIONID cookie 回退
  return fetchWithDirectAccess(contestId, submissionId, jsessionid)
}

/**
 * 通过 VJudge 代理抓取 CF 提交代码
 * VJudge 代理自动处理 Cloudflare Turnstile challenge
 */
async function fetchWithProxy(
  contestId: string,
  submissionId: string,
  proxyConfig: VjudgeProxyConfig
): Promise<{ code: string; codeLength: number } | null> {
  let browser: Browser | null = null
  const port = selectProxyPort(proxyConfig)
  const proxyServer = `http://${proxyConfig.host}:${port}`

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      proxy: {
        server: proxyServer,
        username: proxyConfig.username,
        password: proxyConfig.password,
      },
    })

    const page = await context.newPage()
    const url = `https://codeforces.com/contest/${contestId}/submission/${submissionId}`

    logger.info('cf_code_fetch_proxy_start', {
      action: 'cf_code_fetch',
      metadata: { contestId, submissionId, proxyServer, url },
    })

    await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' })
    // 等待页面加载（VJudge 代理会自动处理 Cloudflare challenge）
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

    // 提取源代码
    const code = await page.$eval('#program-source-text', el => (el as HTMLElement).textContent || '')

    await context.close()
    await browser.close()
    browser = null

    const codeLength = Buffer.byteLength(code, 'utf8')

    logger.info('cf_code_fetch_proxy_success', {
      action: 'cf_code_fetch',
      metadata: { contestId, submissionId, codeLength, proxyServer },
    })

    return { code, codeLength }
  } catch (error) {
    logger.warn('cf_code_fetch_proxy_error', {
      action: 'cf_code_fetch',
      metadata: { contestId, submissionId, proxyServer, error: (error as Error).message },
    })
    if (browser) {
      try { await browser.close() } catch {}
    }
    return null
  }
}

/**
 * 直连 CF + JSESSIONID cookie 抓取（回退方案）
 */
async function fetchWithDirectAccess(
  contestId: string,
  submissionId: string,
  jsessionid?: string
): Promise<{ code: string; codeLength: number } | null> {
  let browser: Browser | null = null
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    })

    if (jsessionid) {
      await context.addCookies([
        {
          name: 'JSESSIONID',
          value: jsessionid,
          domain: '.codeforces.com',
          path: '/',
        },
      ])
    }

    const page = await context.newPage()
    const url = `https://codeforces.com/contest/${contestId}/submission/${submissionId}`

    logger.info('cf_code_fetch_direct_start', {
      action: 'cf_code_fetch',
      metadata: { contestId, submissionId, url, hasCookie: !!jsessionid },
    })

    await page.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

    const code = await page.$eval('#program-source-text', el => (el as HTMLElement).textContent || '')

    await context.close()
    await browser.close()
    browser = null

    const codeLength = Buffer.byteLength(code, 'utf8')

    logger.info('cf_code_fetch_direct_success', {
      action: 'cf_code_fetch',
      metadata: { contestId, submissionId, codeLength },
    })

    return { code, codeLength }
  } catch (error) {
    logger.warn('cf_code_fetch_direct_error', {
      action: 'cf_code_fetch',
      metadata: { contestId, submissionId, error: (error as Error).message },
    })
    if (browser) {
      try { await browser.close() } catch {}
    }
    return null
  }
}

/**
 * 获取提交者的 CF jsessionid cookie
 * 从 UserPlatformBinding 表查找绑定的 CF 账号
 */
async function getCfJsessionid(userId: string): Promise<string | undefined> {
  const binding = await prisma.userPlatformBinding.findFirst({
    where: { userId, platform: 'codeforces' },
    select: { bindingData: true },
  })

  if (!binding?.bindingData) return undefined

  try {
    const data = JSON.parse(binding.bindingData)
    return data.jsessionid || undefined
  } catch {
    return undefined
  }
}

/**
 * 批量扫描 code 为空的 CF 提交，抓取源代码并存储
 * 供定时任务调用
 * 使用提交者绑定的 CF 账号 cookie 绕过 Cloudflare
 */
export async function fetchMissingCfCodes(limit: number = 20): Promise<{ fetched: number; failed: number }> {
  // 查询 code 为空的 CF 归档提交
  const submissions = await prisma.submission.findMany({
    where: {
      oj: 'codeforces',
      code: '',
      ojRemoteId: { not: null },
      problemId: { not: '' },
    },
    select: {
      id: true,
      ojRemoteId: true,
      problemId: true,
      userId: true,
    },
    take: limit,
    orderBy: { createdAt: 'desc' }, // 优先处理最新的
  })

  if (submissions.length === 0) {
    return { fetched: 0, failed: 0 }
  }

  logger.info('cf_code_fetch_batch_start', {
    action: 'cf_code_fetch_batch',
    metadata: { count: submissions.length },
  })

  let fetched = 0
  let failed = 0

  for (const sub of submissions) {
    // 从 problemId 提取 contestId（如 "1669H" → "1669"）
    const match = sub.problemId.match(/^(\d+)/)
    if (!match) {
      failed++
      continue
    }

    const contestId = match[1]

    // 获取提交者的 CF 登录态 cookie
    const jsessionid = await getCfJsessionid(sub.userId)
    const result = await fetchCfSubmissionCode(contestId, sub.ojRemoteId!, jsessionid)

    if (result && result.code) {
      try {
        await prisma.submission.update({
          where: { id: sub.id },
          data: { code: result.code, codeLength: result.codeLength },
        })
        fetched++
      } catch (error) {
        logger.error('cf_code_fetch_store_error', {
          action: 'cf_code_fetch_batch',
          metadata: { submissionId: sub.id, error: (error as Error).message },
        })
        failed++
      }
    } else {
      failed++
    }

    // 间隔 2 秒，避免被 CF 限流
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  logger.info('cf_code_fetch_batch_done', {
    action: 'cf_code_fetch_batch',
    metadata: { fetched, failed, total: submissions.length },
  })

  return { fetched, failed }
}

/**
 * 单条抓取 + 存储（供按需 API 调用）
 * 使用提交者绑定的 CF 账号 cookie
 */
export async function fetchAndStoreCfCode(submissionId: number): Promise<boolean> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      oj: true,
      ojRemoteId: true,
      problemId: true,
      code: true,
      userId: true,
    },
  })

  if (!submission || submission.oj !== 'codeforces' || !submission.ojRemoteId) {
    return false
  }

  // 已有代码则跳过
  if (submission.code && submission.code.length > 0) {
    return true
  }

  const match = submission.problemId.match(/^(\d+)/)
  if (!match) {
    return false
  }

  const contestId = match[1]

  // 获取提交者的 CF 登录态 cookie
  const jsessionid = await getCfJsessionid(submission.userId)
  const result = await fetchCfSubmissionCode(contestId, submission.ojRemoteId, jsessionid)

  if (result && result.code) {
    await prisma.submission.update({
      where: { id: submissionId },
      data: { code: result.code, codeLength: result.codeLength },
    })
    return true
  }

  return false
}
