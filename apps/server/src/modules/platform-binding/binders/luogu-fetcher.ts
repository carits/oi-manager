/**
 * Luogu Fetcher - 请求层
 * 目标：稳定拿到真实页面 HTML
 *
 * 职责：
 * 1. 发起 HTTP 请求
 * 2. 处理 C3VK 挑战页
 * 3. 自动重试直到拿到真实页面
 */

// Node.js 18+ 内置 fetch，无需导入

const LUOGU_HOME_URL = 'https://www.luogu.com.cn/'

/**
 * 构建请求头
 */
export function buildHeaders(): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.luogu.com.cn/',
    'Connection': 'keep-alive',
  }
}

/**
 * 解析 Cookie 字符串为对象
 */
export function parseCookieString(cookieStr: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const item of cookieStr.split(';')) {
    const trimmed = item.trim()
    if (!trimmed || !trimmed.includes('=')) continue
    const [key, ...valueParts] = trimmed.split('=')
    cookies[key.trim()] = valueParts.join('=').trim()
  }
  return cookies
}

/**
 * 将 Cookie 对象转换为字符串
 */
export function cookiesToString(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

/**
 * 从响应中提取 Set-Cookie
 */
export function extractCookiesFromResponse(response: Response): Record<string, string> {
  const cookies: Record<string, string> = {}
  const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : []
  for (const setCookie of setCookies) {
    // Set-Cookie 格式: name=value; Path=/; ...
    const [nameValue] = setCookie.split(';')
    if (nameValue && nameValue.includes('=')) {
      const [key, ...valueParts] = nameValue.split('=')
      cookies[key.trim()] = valueParts.join('=').trim()
    }
  }
  return cookies
}

/**
 * 判断是否为真实首页
 * 特征：包含 _feInjection 数据
 */
export function isRealHomepage(html: string): boolean {
  return html.includes('window._feInjection = JSON.parse(decodeURIComponent("')
}

/**
 * 判断是否为 C3VK 挑战页
 * 特征：包含 C3VK= 和跳转脚本
 */
export function isChallengePage(html: string): boolean {
  return html.includes('C3VK=') && html.includes('window.open("/", "_self")')
}

/**
 * 提取 C3VK 值
 */
export function extractC3VK(html: string): string | null {
  const marker = 'C3VK='
  const p = html.indexOf(marker)
  if (p === -1) return null

  const start = p + marker.length
  const stops: number[] = []

  for (const ch of [';', '"', "'", '\n', '\r', '<']) {
    const idx = html.indexOf(ch, start)
    if (idx !== -1) stops.push(idx)
  }

  if (stops.length === 0) return null
  return html.substring(start, Math.min(...stops)).trim()
}

/**
 * 请求结果
 */
export interface FetchResult {
  /** 是否成功 */
  success: boolean
  /** 页面 HTML */
  html: string
  /** 最终的 Cookies */
  cookies: Record<string, string>
  /** 错误信息 */
  error?: string
  /** 是否为挑战页 */
  isChallenge: boolean
  /** 重试次数 */
  retries: number
}

/**
 * 统一请求包装器：自动处理挑战页
 *
 * @param cookieString - 初始 Cookie 字符串（包含 __client_id 和 _uid）
 * @param maxRetries - 最大重试次数
 * @param onDebug - 调试回调
 */
export async function fetchLuoguPage(
  cookieString: string,
  maxRetries: number = 5,
  onDebug?: (info: { round: number; type: string; preview?: string }) => void
): Promise<FetchResult> {
  const cookies: Record<string, string> = { ...parseCookieString(cookieString) }
  let lastHtml = ''
  let retries = 0

  for (let round = 1; round <= maxRetries; round++) {
    retries = round

    try {
      const response = await fetch(LUOGU_HOME_URL, {
        method: 'GET',
        headers: {
          ...buildHeaders(),
          'Cookie': cookiesToString(cookies),
        },
        redirect: 'follow',
      })

      if (!response.ok) {
        return {
          success: false,
          html: '',
          cookies,
          error: `HTTP ${response.status}: ${response.statusText}`,
          isChallenge: false,
          retries: round,
        }
      }

      // 合并响应中的新 Cookie
      const responseCookies = extractCookiesFromResponse(response)
      Object.assign(cookies, responseCookies)

      // 获取响应文本
      const html = await response.text()
      lastHtml = html

      // 1. 检查是否为真实首页
      if (isRealHomepage(html)) {
        onDebug?.({ round, type: 'real_homepage', preview: html.substring(0, 200) })
        return {
          success: true,
          html,
          cookies,
          isChallenge: false,
          retries: round,
        }
      }

      // 2. 检查是否为挑战页
      if (isChallengePage(html)) {
        const c3vk = extractC3VK(html)
        if (!c3vk) {
          onDebug?.({ round, type: 'challenge_no_c3vk', preview: html.substring(0, 300) })
          return {
            success: false,
            html,
            cookies,
            error: '识别到挑战页，但提取 C3VK 失败',
            isChallenge: true,
            retries: round,
          }
        }

        onDebug?.({ round, type: 'challenge', preview: `C3VK=${c3vk}` })

        // 设置 C3VK Cookie，下一轮重试
        cookies['C3VK'] = c3vk
        continue
      }

      // 3. 未知页面类型
      onDebug?.({ round, type: 'unknown', preview: html.substring(0, 300).replace(/\n/g, '\\n') })
      return {
        success: false,
        html,
        cookies,
        error: '返回未知页面类型',
        isChallenge: false,
        retries: round,
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      onDebug?.({ round, type: 'error', preview: errorMessage })
      return {
        success: false,
        html: lastHtml,
        cookies,
        error: `请求失败: ${errorMessage}`,
        isChallenge: false,
        retries: round,
      }
    }
  }

  // 超过最大重试次数
  return {
    success: false,
    html: lastHtml,
    cookies,
    error: `重试 ${maxRetries} 次后仍未进入真首页`,
    isChallenge: false,
    retries: maxRetries,
  }
}
