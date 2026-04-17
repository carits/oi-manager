/**
 * HDU 提交代理
 * 实现代码提交和评测结果轮询
 *
 * 登录控制逻辑：
 * 1. 优先使用已有的有效 cookie（距登录时间 < renewLoginThresholdMinutes）
 * 2. 如果 cookie 快过期，主动续登
 * 3. 登录失败后冷却 loginFailureCooldownMinutes 分钟
 * 4. 连续失败 maxConsecutiveFailures 次后冻结账号
 */

import { decrypt } from './crypto'
import { logger } from './logger'
import { prisma } from '../prisma'

const HDU_BASE_URL = 'https://acm.hdu.edu.cn'

/**
 * HDU 语言代码映射
 *
 * HDU 语言选项：
 * 0 = G++ (默认，推荐用于 C++)
 * 1 = GCC (C 编译器)
 * 2 = C++
 * 3 = C
 * 4 = Pascal
 * 5 = Java
 * 6 = C#
 */
const HDU_LANGUAGE_MAP: Record<string, string> = {
  'c': '1',        // GCC
  'cpp': '0',      // G++ (推荐)
  'c++': '0',      // G++
  'java': '5',
  'csharp': '6',
  'c#': '6',
  'pascal': '4',
}

/**
 * 将系统语言标识转换为 HDU 语言代码
 */
function mapLanguage(language: string): string {
  // 如果已经是数字，直接返回
  if (/^\d+$/.test(language)) {
    return language
  }
  // 查找映射
  const mapped = HDU_LANGUAGE_MAP[language.toLowerCase()]
  if (mapped) {
    return mapped
  }
  // 默认返回 G++
  return '0'
}

/**
 * HDU 评测结果映射到系统结果
 */
const HDU_RESULT_MAP: Record<string, string> = {
  'Waiting': 'queuing',
  'Compiling': 'queuing',
  'Running': 'queuing',
  'Accepted': 'accepted',
  'Presentation Error': 'pe',
  'Wrong Answer': 'wa',
  'Time Limit Exceeded': 'tle',
  'Memory Limit Exceeded': 'mle',
  'Output Limit Exceeded': 'ole',
  'Runtime Error': 're',
  'Compilation Error': 'ce',
}

export interface HduSubmitResult {
  success: boolean
  ojRemoteId?: string
  cookie?: string  // 提交成功后返回 cookie，供轮询使用
  message: string
  needFreeze?: boolean  // 是否需要冻结账号
}

export interface HduPollResult {
  result: string
  timeUsed?: number
  memoryUsed?: number
}

/**
 * 检查账号是否可用（考虑冷却时间和冻结）
 */
function isAccountAvailable(account: {
  status: string
  enabled: boolean
  lastLoginFailureAt: Date | null
  loginFailureCooldownMinutes: number
  consecutiveFailures: number
  maxConsecutiveFailures: number
}): { available: boolean; reason?: string } {
  if (!account.enabled) {
    return { available: false, reason: '账号已禁用' }
  }

  if (account.status === 'error') {
    // 检查是否在冻结期内（通过 freezeDurationMinutes，但 schema 中没有这个状态字段，用 consecutiveFailures 判断）
    if (account.consecutiveFailures >= account.maxConsecutiveFailures) {
      return { available: false, reason: `连续失败 ${account.consecutiveFailures} 次，账号已冻结` }
    }
  }

  // 检查登录失败冷却时间
  if (account.lastLoginFailureAt) {
    const cooldownMs = account.loginFailureCooldownMinutes * 60 * 1000
    const elapsed = Date.now() - new Date(account.lastLoginFailureAt).getTime()
    if (elapsed < cooldownMs) {
      const remainingMinutes = Math.ceil((cooldownMs - elapsed) / 60000)
      return { available: false, reason: `登录冷却中，剩余 ${remainingMinutes} 分钟` }
    }
  }

  return { available: true }
}

/**
 * 判断是否需要重新登录
 *
 * 逻辑：如果距离上次登录时间 >= cookie有效期 - 提前续登阈值，则需要续登
 * 例如：cookie有效期30分钟，提前续登阈值10分钟，则登录后20分钟就需要续登
 */
function needRelogin(account: {
  cookie: string | null
  lastLoginAt: Date | null
  cookieValidMinutes: number
  renewLoginThresholdMinutes: number
}): boolean {
  // 没有 cookie，需要登录
  if (!account.cookie) {
    return true
  }

  // 没有登录时间记录，需要登录
  if (!account.lastLoginAt) {
    return true
  }

  // 计算续登时间点：cookie 有效期 - 提前续登阈值
  // 例如：30分钟有效期 - 10分钟提前续登 = 20分钟后就需要续登
  const renewBeforeMinutes = account.cookieValidMinutes - account.renewLoginThresholdMinutes
  const renewBeforeMs = renewBeforeMinutes * 60 * 1000
  const elapsed = Date.now() - new Date(account.lastLoginAt).getTime()

  return elapsed >= renewBeforeMs
}

/**
 * 检查最小提交间隔
 */
function canSubmitNow(account: {
  lastSubmitAt: Date | null
  minSubmitIntervalSeconds: number
}): { canSubmit: boolean; waitSeconds?: number } {
  if (!account.lastSubmitAt) {
    return { canSubmit: true }
  }

  const intervalMs = account.minSubmitIntervalSeconds * 1000
  const elapsed = Date.now() - new Date(account.lastSubmitAt).getTime()
  if (elapsed < intervalMs) {
    return { canSubmit: false, waitSeconds: Math.ceil((intervalMs - elapsed) / 1000) }
  }

  return { canSubmit: true }
}

/**
 * 登录 HDU 获取 Cookie
 */
export async function loginHdu(username: string, password: string): Promise<{ success: boolean; cookie?: string; message: string }> {
  try {
    const resp = await fetch(`${HDU_BASE_URL}/userloginex.php?action=login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        'Referer': `${HDU_BASE_URL}/`,
      },
      body: `username=${encodeURIComponent(username)}&userpass=${encodeURIComponent(password)}&login=Sign+In`,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    })

    const setCookies = resp.headers.getSetCookie?.() || []
    const cookies = setCookies.map(sc => sc.match(/^([^;]+)/)?.[1]).filter(Boolean)

    if (cookies.length === 0) {
      return { success: false, message: '登录失败：未获取到 Cookie' }
    }

    return { success: true, cookie: cookies.join('; '), message: '登录成功' }
  } catch (e: any) {
    return { success: false, message: `登录失败：${e.message}` }
  }
}

/**
 * 提交代码到 HDU（带智能登录控制）
 *
 * 登录策略：
 * 1. 检查账号是否可用（冷却期、冻结）
 * 2. 检查提交间隔
 * 3. 优先使用现有 cookie（如果在续登阈值内）
 * 4. 必要时重新登录
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
    // 配置参数
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
  const config = {
    cookieValidMinutes: account.cookieValidMinutes ?? 3600,
    renewLoginThresholdMinutes: account.renewLoginThresholdMinutes ?? 10,
    loginFailureCooldownMinutes: account.loginFailureCooldownMinutes ?? 15,
    minSubmitIntervalSeconds: account.minSubmitIntervalSeconds ?? 30,
    maxConsecutiveFailures: account.maxConsecutiveFailures ?? 3,
    submitMaxRetries: account.submitMaxRetries ?? 1,
  }

  // 1. 检查账号是否可用
  const availability = isAccountAvailable({
    status: 'active',
    enabled: true,
    lastLoginFailureAt: account.lastLoginFailureAt ?? null,
    loginFailureCooldownMinutes: config.loginFailureCooldownMinutes,
    consecutiveFailures: account.consecutiveFailures ?? 0,
    maxConsecutiveFailures: config.maxConsecutiveFailures,
  })

  if (!availability.available) {
    return { success: false, message: availability.reason || '账号不可用', needFreeze: false }
  }

  // 2. 检查提交间隔
  const submitCheck = canSubmitNow({
    lastSubmitAt: account.lastSubmitAt ?? null,
    minSubmitIntervalSeconds: config.minSubmitIntervalSeconds,
  })

  if (!submitCheck.canSubmit) {
    return {
      success: false,
      message: `提交间隔不足，请等待 ${submitCheck.waitSeconds} 秒`,
      needFreeze: false
    }
  }

  // 3. 判断是否需要重新登录
  const shouldRelogin = needRelogin({
    cookie: account.cookie ?? null,
    lastLoginAt: account.lastLoginAt ?? null,
    cookieValidMinutes: config.cookieValidMinutes,
    renewLoginThresholdMinutes: config.renewLoginThresholdMinutes,
  })

  let cookieToUse = account.cookie

  // 4. 如果需要登录
  if (shouldRelogin) {
    logger.info('hdu_relogin_needed', {
      action: 'hdu_submit',
      metadata: {
        username: account.username,
        hasCookie: !!account.cookie,
        lastLoginAt: account.lastLoginAt
      }
    })

    const plainPassword = decrypt(account.password, account.passwordIV)
    const loginResult = await loginHdu(account.username, plainPassword)

    if (!loginResult.success || !loginResult.cookie) {
      // 记录登录失败（也算一次提交尝试）
      await prisma.ojAccount.update({
        where: { id: account.id },
        data: {
          lastLoginFailureAt: new Date(),
          consecutiveFailures: { increment: 1 },
          lastErrorMessage: loginResult.message,
          status: (account.consecutiveFailures ?? 0) + 1 >= config.maxConsecutiveFailures ? 'error' : 'active',
          totalSubmissions: { increment: 1 },
          totalSubmissionErrors: { increment: 1 }
        }
      })

      return {
        success: false,
        message: loginResult.message,
        needFreeze: (account.consecutiveFailures ?? 0) + 1 >= config.maxConsecutiveFailures
      }
    }

    cookieToUse = loginResult.cookie

    // 更新登录成功状态（包括保存新 cookie）
    await prisma.ojAccount.update({
      where: { id: account.id },
      data: {
        cookie: loginResult.cookie,
        cookieRaw: loginResult.cookie,
        lastLoginAt: new Date(),
        lastLoginFailureAt: null,
        consecutiveFailures: 0,
        status: 'active'
      }
    })

    logger.info('hdu_login_success', {
      action: 'hdu_submit',
      metadata: { username: account.username, cookiePreview: cookieToUse.substring(0, 30) }
    })
  } else {
    logger.info('hdu_reuse_cookie', {
      action: 'hdu_submit',
      metadata: { username: account.username }
    })
  }

  // 5. 提交代码（带重试）
  let lastError = ''
  const maxRetries = config.submitMaxRetries

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // 每次尝试都计入统计
    await prisma.ojAccount.update({
      where: { id: account.id },
      data: { totalSubmissions: { increment: 1 } }
    })

    try {
      // 先访问提交页面，建立 session
      const submitPageResp = await fetch(`${HDU_BASE_URL}/submit.php?pid=${problemId}`, {
        method: 'GET',
        headers: {
          'Cookie': cookieToUse!,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Referer': `${HDU_BASE_URL}/showproblem.php?pid=${problemId}`,
        },
        signal: AbortSignal.timeout(15000),
      })

      logger.info('hdu_submit_page', {
        action: 'hdu_submit',
        metadata: { problemId, attempt, status: submitPageResp.status }
      })

      // 获取页面返回的额外 cookies（如果有）
      const extraCookies = submitPageResp.headers.getSetCookie?.() || []
      let allCookies = [cookieToUse, ...extraCookies.map(sc => sc.match(/^([^;]+)/)?.[1]).filter(Boolean)].join('; ')

      // 提交代码
      // HDU 要求代码用 base64 编码放到 _usercode 字段
      // JavaScript: form._usercode.value = btoa(encodeURIComponent(form.usercode.value))
      const encodedCode = Buffer.from(encodeURIComponent(code)).toString('base64')

      const params = new URLSearchParams()
      params.append('_usercode', encodedCode)
      params.append('problemid', problemId)
      params.append('language', mapLanguage(language))
      params.append('check', '0')  // check 字段（验证码相关，默认 0）

      const submitResp = await fetch(`${HDU_BASE_URL}/submit.php?action=submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': allCookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Origin': HDU_BASE_URL,
          'Referer': `${HDU_BASE_URL}/submit.php?pid=${problemId}`,
        },
        body: params.toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      })

      logger.info('hdu_submit_response', {
        action: 'hdu_submit',
        metadata: { problemId, attempt, status: submitResp.status, location: submitResp.headers.get('location') }
      })

      // 检查提交结果并获取 remote ID
      if (submitResp.status === 302) {
        const location = submitResp.headers.get('location') || ''

        if (location.includes('status')) {
          // 从 status 页面获取最新的提交 ID
          const ojRemoteId = await getLatestSubmitId(allCookies, account.username)

          // 更新提交成功状态
          await prisma.ojAccount.update({
            where: { id: account.id },
            data: {
              lastSubmitAt: new Date(),
              cookie: allCookies,
              consecutiveFailures: 0,
              status: 'active'
            }
          })

          return { success: true, ojRemoteId, cookie: allCookies, message: '提交成功' }
        }

        if (location.includes('login')) {
          // Cookie 失效，需要重新登录
          await prisma.ojAccount.update({
            where: { id: account.id },
            data: {
              cookie: null,
              lastErrorMessage: 'Cookie 已失效'
            }
          })
          return { success: false, message: '登录已过期，请重新登录' }
        }
      }

      // 如果返回 200，可能是页面有错误信息
      if (submitResp.status === 200) {
        const text = await submitResp.text()
        if (text.includes('Error') || text.includes('error')) {
          lastError = '提交失败：页面返回错误'
          continue
        }
      }

      // 403 错误：可能是 cookie 过期或 IP 被 WAF 封禁
      if (submitResp.status === 403) {
        // 如果是第一次尝试且还没有重新登录，尝试重新登录
        if (attempt === 1 && !shouldRelogin) {
          logger.info('hdu_403_retry_login', {
            action: 'hdu_submit',
            metadata: { problemId, username: account.username, reason: 'cookie may be expired' }
          })

          // 重新登录
          const plainPassword = decrypt(account.password, account.passwordIV)
          const loginResult = await loginHdu(account.username, plainPassword)

          if (loginResult.success && loginResult.cookie) {
            cookieToUse = loginResult.cookie
            allCookies = cookieToUse

            // 更新数据库
            await prisma.ojAccount.update({
              where: { id: account.id },
              data: {
                cookie: loginResult.cookie,
                cookieRaw: loginResult.cookie,
                lastLoginAt: new Date(),
                lastLoginFailureAt: null,
                consecutiveFailures: 0,
                status: 'active'
              }
            })

            logger.info('hdu_403_login_success', {
              action: 'hdu_submit',
              metadata: { username: account.username }
            })

            // 继续下一次尝试（不跳过）
            continue
          } else {
            // 登录也失败，可能是 IP 被 WAF 封禁
            logger.warn('hdu_403_login_failed', {
              action: 'hdu_submit',
              metadata: { username: account.username, message: loginResult.message }
            })
          }
        }

        // 登录后仍然 403，或已经是重新登录后的尝试，说明是 IP 封禁
        await prisma.ojAccount.update({
          where: { id: account.id },
          data: {
            lastRateLimitAt: new Date(),
            rateLimitCount: { increment: 1 }
          }
        })

        lastError = 'HTTP 403 - IP 可能被 HDU 封禁，请稍后重试或配置代理'
        logger.warn('hdu_403_waf', {
          action: 'hdu_submit',
          metadata: { problemId, attempt, message: 'IP may be blocked by HDU WAF' }
        })
        // WAF 封锁，重试无意义
        return {
          success: false,
          message: lastError,
          needFreeze: false
        }
      }

      lastError = `HTTP ${submitResp.status}`
    } catch (e: any) {
      logger.error('hdu_submit_error', {
        action: 'hdu_submit',
        metadata: { problemId, attempt, error: e.message }
      })
      lastError = e.message
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  }

  // 提交失败，更新状态
  await prisma.ojAccount.update({
    where: { id: account.id },
    data: {
      consecutiveFailures: { increment: 1 },
      lastErrorMessage: lastError,
      status: (account.consecutiveFailures ?? 0) + 1 >= config.maxConsecutiveFailures ? 'error' : 'active',
      totalSubmissionErrors: { increment: 1 }
    }
  })

  return {
    success: false,
    message: `提交失败: ${lastError}`,
    needFreeze: (account.consecutiveFailures ?? 0) + 1 >= config.maxConsecutiveFailures
  }
}

/**
 * 获取最新的提交 ID
 */
async function getLatestSubmitId(cookie: string, username: string): Promise<string | undefined> {
  try {
    const resp = await fetch(`${HDU_BASE_URL}/status.php?user=${encodeURIComponent(username)}`, {
      headers: {
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })

    const buffer = await resp.arrayBuffer()
    const html = new TextDecoder('gb2312').decode(buffer)

    // 匹配提交 ID，格式如：<td height=22px>370353240</td>
    const match = html.match(/<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>/)
    if (match) {
      return match[1]
    }

    // 备用匹配：找第一个纯数字的 td
    const idMatch = html.match(/<td[^>]*height[^>]*>(\d{7,})<\/td>/)
    return idMatch?.[1]
  } catch {
    return undefined
  }
}

/**
 * 轮询 HDU 评测结果
 * HDU status 页面无需登录即可查看，直接请求即可
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
    // HDU status 页面无需登录，直接查询
    const resp = await fetch(`${HDU_BASE_URL}/status.php?first=${ojRemoteId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    })

    const buffer = await resp.arrayBuffer()
    const html = new TextDecoder('gb2312').decode(buffer)

    // 解析评测结果
    // HDU 状态页表格结构：RunID | Submit Time | Result | Pro.ID | Exe.Time | Exe.Memory | Code Len. | Language | Author
    // 结果可能包含在 <font> 标签中，如 <font color=green>Wrong Answer</font>

    // 先找到对应 Run ID 的行
    const rowMatch = html.match(new RegExp(`<td[^>]*>\\s*${ojRemoteId}\\s*</td>[\\s\\S]*?</tr>`, 'i'))

    if (rowMatch) {
      const row = rowMatch[0]

      // 提取结果：在 RunID 和 Submit Time 之后，Problem ID 之前
      // HDU 格式：<td><font color=...>结果<br>(可能有额外信息)</font></td>
      // 简化：直接匹配 <td> 后的结果关键词
      const resultMatch = row.match(/<td[^>]*>(?:<font[^>]*>)?\s*([A-Za-z][A-Za-z\s]+?)(?:<br|\s*<\/font>|<\/td>)/i)

      // 提取时间：XXMS 格式
      const timeMatch = row.match(/(\d+)\s*MS/i)

      // 提取内存：XXK 格式
      const memMatch = row.match(/(\d+)\s*K/i)

      if (resultMatch) {
        const rawResult = resultMatch[1].trim()
        const timeUsed = timeMatch ? parseInt(timeMatch[1]) : undefined
        const memoryUsed = memMatch ? parseInt(memMatch[1]) : undefined

        const result = HDU_RESULT_MAP[rawResult] || 'queuing'

        return {
          result,
          timeUsed,
          memoryUsed,  // 保持 KB 原始值，前端转换为 MB
        }
      }
    }

    // 备用解析：按优先级匹配（先匹配更具体的结果）
    const resultPriority = ['Accepted', 'Wrong Answer', 'Time Limit Exceeded', 'Memory Limit Exceeded', 'Output Limit Exceeded', 'Runtime Error', 'Compilation Error', 'Presentation Error']
    for (const hduResult of resultPriority) {
      if (html.includes(hduResult)) {
        const systemResult = HDU_RESULT_MAP[hduResult]
        if (systemResult) {
          const timeMatch = html.match(/(\d+)\s*MS/i)
          const memMatch = html.match(/(\d+)\s*K/i)

          return {
            result: systemResult,
            timeUsed: timeMatch ? parseInt(timeMatch[1]) : undefined,
            memoryUsed: memMatch ? parseInt(memMatch[1]) : undefined,  // 保持 KB 原始值
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

/**
 * 获取远程提交链接
 */
export function getHduRemoteUrl(ojRemoteId: string): string {
  return `${HDU_BASE_URL}/status.php?first=${ojRemoteId}`
}