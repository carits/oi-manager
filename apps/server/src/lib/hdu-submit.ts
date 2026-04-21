/**
 * HDU 提交代理
 *
 * Cookie 策略：优先复用已有 cookie，只在以下情况重新登录：
 * 1. 没有 cookie 或 cookie 已过期（按 cookieValidMinutes 判断）
 * 2. 提交被 302 重定向到登录页（cookie 实际失效）
 * 3. 重试时强制重新登录
 */

import { decrypt } from './crypto'
import { logger } from './logger'
import { prisma } from '../prisma'

const HDU_BASE_URL = 'https://acm.hdu.edu.cn'

const HDU_LANGUAGE_MAP: Record<string, string> = {
  'c': '1',
  'cpp': '0',
  'c++': '0',
  'java': '5',
  'csharp': '6',
  'c#': '6',
  'pascal': '4',
}

function mapLanguage(language: string): string {
  if (/^\d+$/.test(language)) return language
  return HDU_LANGUAGE_MAP[language.toLowerCase()] || '0'
}

const HDU_RESULT_MAP: Record<string, string> = {
  'Waiting': 'queuing',
  'Compiling': 'queuing',
  'Running': 'queuing',
  'Running & Judging': 'queuing',
  'Accepted': 'accepted',
  'Presentation Error': 'pe',
  'Wrong Answer': 'wa',
  'Time Limit Exceeded': 'tle',
  'Memory Limit Exceeded': 'mle',
  'Output Limit Exceeded': 'ole',
  'Runtime Error': 're',
  'Runtime Error(ACCESS_VIOLATION)': 're',
  'Compilation Error': 'ce',
  'System Error': 'se',
  'Validator Error': 'se',
}

export interface HduSubmitResult {
  success: boolean
  ojRemoteId?: string
  cookie?: string
  message: string
  needFreeze?: boolean
}

export interface HduPollResult {
  result: string
  timeUsed?: number
  memoryUsed?: number
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

/** WAF 拦截关键词 */
const WAF_MARKERS = ['Block Event ID', 'blocked by the site administrator']

/** 检测响应是否为 HDU WAF 拦截页面 */
async function isWafBlock(resp: Response): Promise<boolean> {
  if (resp.status !== 403) return false
  try {
    const text = await resp.text()
    return WAF_MARKERS.some(m => text.includes(m))
  } catch {
    return false
  }
}

/**
 * 登录 HDU，返回 cookie 或 null
 */
async function doLogin(username: string, password: string): Promise<string | null> {
  const resp = await fetch(`${HDU_BASE_URL}/userloginex.php?action=login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      'Referer': `${HDU_BASE_URL}/`,
    },
    body: `username=${encodeURIComponent(username)}&userpass=${encodeURIComponent(password)}&login=Sign+In`,
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  })

  if (resp.status !== 302) {
    logger.warn('hdu_login_bad_status', { action: 'hdu', metadata: { status: resp.status } })
    return null
  }

  const setCookies = resp.headers.getSetCookie?.() || []
  const cookies = setCookies.map(sc => sc.match(/^([^;]+)/)?.[1]).filter(Boolean)
  if (cookies.length === 0) return null

  return cookies.join('; ')
}

/**
 * 判断已有 cookie 是否仍有效
 */
function isCookieFresh(account: { cookie?: string | null; lastLoginAt?: Date | null; cookieValidMinutes?: number }): boolean {
  if (!account.cookie || !account.lastLoginAt) return false
  const validMs = (account.cookieValidMinutes || 3600) * 60 * 1000
  return Date.now() - new Date(account.lastLoginAt).getTime() < validMs
}

/**
 * 提交代码到 HDU
 *
 * 策略：复用有效 cookie，提交失败时重新登录重试。
 */
export async function submitToHdu(
  account: {
    id: string
    username: string
    password: string
    passwordIV: string
    cookie?: string | null
    lastLoginAt?: Date | null
    lastLoginFailureAt?: Date | null
    lastSubmitAt?: Date | null
    consecutiveFailures?: number
    cookieValidMinutes?: number
    renewLoginThresholdMinutes?: number
    loginFailureCooldownMinutes?: number
    minSubmitIntervalSeconds?: number
    maxConsecutiveFailures?: number
    submitMaxRetries?: number
  },
  problemId: string,
  language: string,
  code: string
): Promise<HduSubmitResult> {
  const MAX_RETRIES = 3
  const plainPassword = decrypt(account.password, account.passwordIV)

  // 检查账号冻结
  if ((account.consecutiveFailures ?? 0) >= (account.maxConsecutiveFailures || 3)) {
    return { success: false, message: `连续失败 ${account.consecutiveFailures} 次，账号已冻结` }
  }

  // 检查冷却期
  if (account.lastLoginFailureAt) {
    const cooldownMs = (account.loginFailureCooldownMinutes || 15) * 60 * 1000
    const elapsed = Date.now() - new Date(account.lastLoginFailureAt).getTime()
    if (elapsed < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - elapsed) / 60000)
      return { success: false, message: `登录冷却中，剩余 ${remaining} 分钟` }
    }
  }

  // 检查提交间隔
  if (account.lastSubmitAt) {
    const intervalMs = (account.minSubmitIntervalSeconds || 30) * 1000
    const elapsed = Date.now() - new Date(account.lastSubmitAt).getTime()
    if (elapsed < intervalMs) {
      const wait = Math.ceil((intervalMs - elapsed) / 1000)
      return { success: false, message: `提交间隔不足，请等待 ${wait} 秒` }
    }
  }

  let cookieToUse: string | null = null
  let lastError = ''

  // 初始 cookie：有有效 cookie 就复用
  const reuseCookie = isCookieFresh(account)
  if (reuseCookie) {
    cookieToUse = account.cookie!
    logger.info('hdu_reuse_cookie', { action: 'hdu_submit', metadata: { username: account.username } })
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // 需要登录的情况：没有 cookie / 重试时强制重新登录
      if (!cookieToUse) {
        logger.info('hdu_login_attempt', {
          action: 'hdu_submit',
          metadata: { attempt, username: account.username, problemId }
        })

        cookieToUse = await doLogin(account.username, plainPassword)
        if (!cookieToUse) {
          lastError = '登录失败：未获取到 Cookie'
          logger.warn('hdu_login_failed', { action: 'hdu_submit', metadata: { attempt, username: account.username } })

          await prisma.ojAccount.update({
            where: { id: account.id },
            data: {
              lastLoginFailureAt: new Date(),
              consecutiveFailures: { increment: 1 },
              lastErrorMessage: lastError,
            }
          })
          if (attempt < MAX_RETRIES) { await sleep(2000); continue }
          break
        }

        // 登录成功，更新数据库
        await prisma.ojAccount.update({
          where: { id: account.id },
          data: {
            cookie: cookieToUse,
            cookieRaw: cookieToUse,
            lastLoginAt: new Date(),
            lastLoginFailureAt: null,
            consecutiveFailures: 0,
            status: 'active',
          }
        })

        logger.info('hdu_login_ok', { action: 'hdu_submit', metadata: { attempt, username: account.username } })
      }

      // 访问提交页（确认 cookie 仍有效）
      const submitPageResp = await fetch(`${HDU_BASE_URL}/submit.php?pid=${problemId}`, {
        method: 'GET',
        headers: {
          'Cookie': cookieToUse,
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Referer': `${HDU_BASE_URL}/showproblem.php?pid=${problemId}`,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      })

      // 提交页被重定向到登录页 → cookie 已失效，重新登录
      if (submitPageResp.status === 302) {
        const loc = submitPageResp.headers.get('location') || ''
        if (loc.includes('login') || loc.includes('userlogin')) {
          logger.warn('hdu_cookie_expired', { action: 'hdu_submit', metadata: { attempt, location: loc } })
          cookieToUse = null // 清掉，下一轮循环会重新登录
          await prisma.ojAccount.update({ where: { id: account.id }, data: { cookie: null } })
          if (attempt < MAX_RETRIES) { await sleep(1000); continue }
          lastError = 'Cookie 已失效且重新登录失败'
          break
        }
      }

      if (submitPageResp.status === 403) {
        // 检测 WAF 拦截
        if (await isWafBlock(submitPageResp)) {
          lastError = 'WAF 封禁：IP 被 HDU 防火墙拦截'
          logger.warn('hdu_waf_blocked', { action: 'hdu_submit', metadata: { attempt, username: account.username } })
          await prisma.ojAccount.update({
            where: { id: account.id },
            data: {
              status: 'error',
              lastLoginFailureAt: new Date(),
              lastErrorMessage: lastError,
              consecutiveFailures: { increment: 1 },
              totalSubmissions: { increment: 1 },
              totalSubmissionErrors: { increment: 1 },
            }
          })
          return { success: false, message: lastError, needFreeze: true }
        }
        lastError = '访问提交页被 403 拒绝'
        logger.warn('hdu_submit_page_403', { action: 'hdu_submit', metadata: { attempt } })
        cookieToUse = null // 重新登录试试
        if (attempt < MAX_RETRIES) { await sleep(3000); continue }
        break
      }

      // 收集额外 cookie
      const extraCookies = submitPageResp.headers.getSetCookie?.() || []
      const allCookies = [cookieToUse, ...extraCookies.map(sc => sc.match(/^([^;]+)/)?.[1]).filter(Boolean)].join('; ')

      // 提交代码
      const encodedCode = Buffer.from(encodeURIComponent(code)).toString('base64')
      const params = new URLSearchParams()
      params.append('_usercode', encodedCode)
      params.append('problemid', problemId)
      params.append('language', mapLanguage(language))
      params.append('check', '0')

      const submitResp = await fetch(`${HDU_BASE_URL}/submit.php?action=submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': allCookies,
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Origin': HDU_BASE_URL,
          'Referer': `${HDU_BASE_URL}/submit.php?pid=${problemId}`,
        },
        body: params.toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      })

      logger.info('hdu_submit_resp', {
        action: 'hdu_submit',
        metadata: { attempt, status: submitResp.status, location: submitResp.headers.get('location') }
      })

      if (submitResp.status === 302) {
        const location = submitResp.headers.get('location') || ''

        if (location.includes('status')) {
          const ojRemoteId = await getLatestSubmitId(allCookies, account.username)

          await prisma.ojAccount.update({
            where: { id: account.id },
            data: {
              lastSubmitAt: new Date(),
              cookie: allCookies,
              consecutiveFailures: 0,
              status: 'active',
              totalSubmissions: { increment: 1 },
              lastErrorMessage: null,
            }
          })

          logger.info('hdu_submit_success', {
            action: 'hdu_submit',
            metadata: { ojRemoteId, username: account.username, problemId }
          })

          return { success: true, ojRemoteId, cookie: allCookies, message: '提交成功' }
        }

        // 提交 POST 被 302 到登录页 → cookie 失效
        if (location.includes('login') || location.includes('userlogin')) {
          logger.warn('hdu_submit_cookie_expired', { action: 'hdu_submit', metadata: { attempt } })
          cookieToUse = null
          await prisma.ojAccount.update({ where: { id: account.id }, data: { cookie: null } })
          if (attempt < MAX_RETRIES) { await sleep(1000); continue }
          lastError = '提交时 Cookie 失效'
          break
        }

        lastError = `提交被重定向: ${location}`
        if (attempt < MAX_RETRIES) { await sleep(2000); continue }
        break
      }

      if (submitResp.status === 403) {
        // 检测 WAF 拦截
        if (await isWafBlock(submitResp)) {
          lastError = 'WAF 封禁：IP 被 HDU 防火墙拦截'
          logger.warn('hdu_waf_blocked_submit', { action: 'hdu_submit', metadata: { attempt, username: account.username } })
          await prisma.ojAccount.update({
            where: { id: account.id },
            data: {
              status: 'error',
              lastLoginFailureAt: new Date(),
              lastErrorMessage: lastError,
              consecutiveFailures: { increment: 1 },
              totalSubmissions: { increment: 1 },
              totalSubmissionErrors: { increment: 1 },
            }
          })
          return { success: false, message: lastError, needFreeze: true }
        }
        lastError = 'HTTP 403'
        cookieToUse = null
        if (attempt < MAX_RETRIES) { await sleep(3000); continue }
        break
      }

      if (submitResp.status === 200) {
        const text = await submitResp.text()
        if (text.includes('captcha') || text.includes('验证码') || text.includes('checkcode')) {
          lastError = 'HDU 要求验证码'
          break // 验证码问题重试没用
        }
        if (text.includes('Error') || text.includes('error') || text.includes('错误')) {
          lastError = '提交页面返回错误'
          if (attempt < MAX_RETRIES) { await sleep(2000); continue }
          break
        }
      }

      lastError = `HTTP ${submitResp.status}`
    } catch (e: any) {
      lastError = e.message
      logger.error('hdu_submit_exception', {
        action: 'hdu_submit',
        metadata: { attempt, error: e.message }
      })
      if (attempt < MAX_RETRIES) { await sleep(2000) }
    }
  }

  // 所有重试都失败
  const newFailures = (account.consecutiveFailures ?? 0) + 1
  const shouldFreeze = newFailures >= (account.maxConsecutiveFailures || 3)

  await prisma.ojAccount.update({
    where: { id: account.id },
    data: {
      consecutiveFailures: { increment: 1 },
      lastErrorMessage: lastError,
      status: shouldFreeze ? 'error' : 'active',
      totalSubmissions: { increment: 1 },
      totalSubmissionErrors: { increment: 1 },
    }
  })

  return {
    success: false,
    message: `提交失败: ${lastError}`,
    needFreeze: shouldFreeze,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 获取最新提交 ID
 * 从 status 页面解析用户最新一条提交的 Run ID
 */
async function getLatestSubmitId(cookie: string, username: string): Promise<string | undefined> {
  try {
    const resp = await fetch(`${HDU_BASE_URL}/status.php?user=${encodeURIComponent(username)}`, {
      headers: {
        'Cookie': cookie,
        'User-Agent': UA,
      },
      signal: AbortSignal.timeout(10000),
    })

    const buffer = await resp.arrayBuffer()
    const html = new TextDecoder('gb2312').decode(buffer)

    // HDU status 页面表格：每行以 <tr> 开始
    // 第一个 <td> 是 Run ID（纯数字，7位以上）
    // 匹配第一个表格行中的第一个数字 td
    const rowMatch = html.match(/<tr[^>]*>\s*<td[^>]*>(\d{6,})<\/td>/i)
    if (rowMatch) {
      return rowMatch[1]
    }

    // 备用：找页面中第一个 7 位以上的数字
    const idMatch = html.match(/<td[^>]*>(\d{7,})<\/td>/)
    return idMatch?.[1]
  } catch {
    return undefined
  }
}

/**
 * 轮询 HDU 评测结果
 */
export async function pollHduResult(
  _account: {
    username: string
    password: string
    passwordIV: string
    cookie?: string | null
  },
  ojRemoteId: string
): Promise<HduPollResult | null> {
  try {
    const resp = await fetch(`${HDU_BASE_URL}/status.php?first=${ojRemoteId}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    })

    const buffer = await resp.arrayBuffer()
    const html = new TextDecoder('gb2312').decode(buffer)

    // 找到包含指定 Run ID 的行
    const rowRegex = new RegExp(`<td[^>]*>\\s*${ojRemoteId}\\s*</td>([\\s\\S]*?)</tr>`, 'i')
    const rowMatch = html.match(rowRegex)

    if (rowMatch) {
      const row = rowMatch[1]

      // 提取结果（在 font 标签或直接在 td 中）
      const resultMatch = row.match(/>([^<]*(?:Accepted|Wrong Answer|Time Limit|Memory Limit|Output Limit|Runtime Error|Compilation Error|Presentation Error|System Error|Validator Error|Waiting|Compiling|Running)[^<]*)</i)

      // 提取时间（XXMS）
      const timeMatch = row.match(/(\d+)\s*MS/i)

      // 提取内存（XXK）
      const memMatch = row.match(/(\d+)\s*K/i)

      if (resultMatch) {
        const rawResult = resultMatch[1].trim()
        const result = HDU_RESULT_MAP[rawResult] || 'queuing'

        return {
          result,
          timeUsed: timeMatch ? parseInt(timeMatch[1]) : undefined,
          memoryUsed: memMatch ? parseInt(memMatch[1]) : undefined,
        }
      }
    }

    // 备用：在整页中搜索结果关键词
    const resultPriority = [
      'Accepted', 'Wrong Answer', 'Time Limit Exceeded',
      'Memory Limit Exceeded', 'Output Limit Exceeded',
      'Runtime Error', 'Compilation Error', 'Presentation Error',
      'Waiting', 'Compiling', 'Running'
    ]
    for (const hduResult of resultPriority) {
      if (html.includes(hduResult)) {
        const systemResult = HDU_RESULT_MAP[hduResult]
        if (systemResult) {
          const timeMatch = html.match(/(\d+)\s*MS/i)
          const memMatch = html.match(/(\d+)\s*K/i)
          return {
            result: systemResult,
            timeUsed: timeMatch ? parseInt(timeMatch[1]) : undefined,
            memoryUsed: memMatch ? parseInt(memMatch[1]) : undefined,
          }
        }
      }
    }

    return null
  } catch (e: any) {
    logger.error('hdu_poll_error', {
      action: 'hdu_poll',
      metadata: { ojRemoteId, error: e.message }
    })
    return null
  }
}

export function getHduRemoteUrl(ojRemoteId: string): string {
  return `${HDU_BASE_URL}/status.php?first=${ojRemoteId}`
}

/**
 * 手动登录 HDU（用于 OJ 账号验证接口）
 */
export async function loginHdu(username: string, password: string): Promise<{ success: boolean; cookie?: string; message: string }> {
  try {
    const cookie = await doLogin(username, password)
    if (cookie) {
      return { success: true, cookie, message: '登录成功' }
    }
    return { success: false, message: '登录失败：未获取到 Cookie' }
  } catch (e: any) {
    return { success: false, message: `登录失败：${e.message}` }
  }
}
