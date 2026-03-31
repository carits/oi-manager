/**
 * VJudge Session Manager - 会话管理器
 *
 * 职责：
 * 1. Cookie Jar 自动管理
 * 2. 登录流程
 * 3. 登录状态验证
 * 4. Cookie 持久化
 */

import { CookieJar, Cookie } from 'tough-cookie'

const VJUDGE_BASE_URL = 'https://vjudge.net/'
const VJUDGE_LOGIN_URL = 'https://vjudge.net/user/login'

/**
 * 登录结果
 */
export interface LoginResult {
  success: boolean
  message?: string
  username?: string
}

/**
 * 登录状态
 */
export interface LoginStatus {
  logged_in: boolean
  username?: string
  reason?: string
}

/**
 * 会话数据（用于持久化存储）
 */
export interface VJudgeSessionData {
  cookies: string // CookieJar 序列化后的 JSON
  username: string
  password: string // 存储密码用于自动重登录
  verifiedAt: string
}

/**
 * 构建请求头
 */
function buildHeaders(): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Connection': 'keep-alive',
  }
}

/**
 * VJudge 团队列表项
 */
export interface VjudgeGroupItem {
  groupId: string      // short_name
  groupName: string    // 团队名
}

/**
 * VJudge 团队详情
 */
export interface VjudgeGroupDetails {
  groupId: string
  groupName: string
  groupDescription: string
  announcement: string
  avatarUrl: string
  members: VjudgeMember[]
}

/**
 * VJudge 成员
 */
export interface VjudgeMember {
  username: string
  nickname: string
}

/**
 * VJudge 会话管理器
 */
export class VJudgeSession {
  private jar: CookieJar
  private username: string | null = null

  constructor(initialCookies?: string) {
    this.jar = new CookieJar(undefined, {
      allowSpecialUseDomain: true,
      looseMode: true,
    })

    if (initialCookies) {
      this.loadCookies(initialCookies)
    }
  }

  /**
   * 保存 Cookie Jar 到字符串
   */
  async saveCookies(): Promise<string> {
    const cookies = await this.jar.serialize()
    return JSON.stringify(cookies)
  }

  /**
   * 从字符串恢复 Cookie Jar
   */
  /**
   * 从原始 Cookie 字符串加载（如 "key1=val1; key2=val2"）
   */
  loadRawCookieString(cookieStr: string, domain: string = 'vjudge.net'): void {
    const pairs = cookieStr.split(';').map(s => s.trim()).filter(Boolean)
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=')
      if (eqIdx === -1) continue
      const key = pair.substring(0, eqIdx).trim()
      const value = pair.substring(eqIdx + 1).trim()
      try {
        const cookie = new Cookie({ key, value, domain, path: '/' })
        this.jar.setCookieSync(cookie, `https://${domain}/`)
      } catch (e) {
        console.error(`[VJudge] Failed to load raw cookie: ${key}`, e)
      }
    }
    console.log(`[VJudge] loadRawCookieString: loaded ${pairs.length} cookies`)
  }

  loadCookies(data: string): void {
    try {
      const parsed = JSON.parse(data)
      console.log('[VJudge] loadCookies: parsed type =', typeof parsed, Array.isArray(parsed))

      // tough-cookie v6 序列化格式可能是对象 { cookies: [...] } 或数组 [...]
      let cookies: any[]
      if (Array.isArray(parsed)) {
        cookies = parsed
      } else if (parsed && Array.isArray(parsed.cookies)) {
        cookies = parsed.cookies
      } else {
        console.log('[VJudge] loadCookies: unknown format, keys =', parsed ? Object.keys(parsed) : 'null')
        return
      }

      console.log('[VJudge] loadCookies: loading', cookies.length, 'cookies')
      for (const cookieData of cookies) {
        try {
          const cookie = Cookie.fromJSON(cookieData)
          if (cookie) {
            const domain = cookieData.domain || 'vjudge.net'
            const path = cookieData.path || '/'
            this.jar.setCookieSync(cookie, `https://${domain}${path}`)
          }
        } catch (e) {
          console.error('[VJudge] Failed to load cookie:', cookieData.key, e)
        }
      }
    } catch (err) {
      console.error('[VJudge] Failed to load cookies:', err)
    }
  }

  /**
   * 加载 Cookie 但过滤掉指定的前缀/名称（如 Cloudflare、分析 Cookie）
   * 避免 Cloudflare 拦截旧 Cookie
   */
  loadCookiesFiltered(data: string, skipPrefixes: string[] = []): void {
    try {
      const parsed = JSON.parse(data)
      let cookies: any[]
      if (Array.isArray(parsed)) {
        cookies = parsed
      } else if (parsed && Array.isArray(parsed.cookies)) {
        cookies = parsed.cookies
      } else {
        return
      }

      const filtered = cookies.filter(c => {
        const key = c.key || ''
        return !skipPrefixes.some(prefix => key.startsWith(prefix) || key === prefix)
      })

      console.log(`[VJudge] loadCookiesFiltered: ${cookies.length} total, ${filtered.length} after filter (skipped keys: ${cookies.filter(c => !filtered.includes(c)).map(c => c.key).join(', ')})`)

      for (const cookieData of filtered) {
        try {
          const cookie = Cookie.fromJSON(cookieData)
          if (cookie) {
            const domain = cookieData.domain || 'vjudge.net'
            const path = cookieData.path || '/'
            this.jar.setCookieSync(cookie, `https://${domain}${path}`)
          }
        } catch (e) {
          // ignore
        }
      }
    } catch (err) {
      console.error('[VJudge] loadCookiesFiltered failed:', err)
    }
  }

  /**
   * 发起请求（自动处理 Cookie，带超时）
   */
  private async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    // 1. 从 Jar 获取当前 URL 的 Cookie
    const cookies = await this.jar.getCookies(url)
    const cookieHeader = cookies.map((c) => `${c.key}=${c.value}`).join('; ')

    // 2. 设置超时（20秒）
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)

    // 3. 发起请求
    let response: Response
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          ...buildHeaders(),
          ...options.headers,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        redirect: 'manual', // 手动处理重定向以捕获 Set-Cookie
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    // 4. 保存响应中的 Set-Cookie
    const setCookies = response.headers.getSetCookie?.() || []
    for (const setCookie of setCookies) {
      try {
        const cookie = Cookie.parse(setCookie)
        if (cookie) {
          await this.jar.setCookie(cookie, url)
        }
      } catch (e) {
        // 忽略解析错误
      }
    }

    return response
  }

  /**
   * 处理重定向并跟随
   */
  private async fetchWithRedirect(url: string, options: RequestInit = {}, maxRedirects = 5): Promise<Response> {
    let currentUrl = url
    let response = await this.fetch(currentUrl, options)

    for (let i = 0; i < maxRedirects; i++) {
      const status = response.status
      if (status >= 300 && status < 400) {
        const location = response.headers.get('location')
        if (location) {
          // 处理相对路径
          currentUrl = new URL(location, currentUrl).toString()
          response = await this.fetch(currentUrl, { method: 'GET' })
          continue
        }
      }
      break
    }

    return response
  }

  /**
   * 登录流程
   */
  async login(username: string, password: string): Promise<LoginResult> {
    try {
      console.log(`[VJudge] Starting login for: ${username}`)

      // 1. 先访问首页，获取初始 Cookie（包括 Cloudflare）
      console.log('[VJudge] Step 1: Visiting homepage...')
      const homeResp = await this.fetchWithRedirect(VJUDGE_BASE_URL)

      // 不再检查首页内容，直接继续登录流程
      console.log(`[VJudge] Homepage status: ${homeResp.status}`)

      // 2. POST 登录
      console.log('[VJudge] Step 2: Posting login...')
      const loginResp = await this.fetch(VJUDGE_LOGIN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': 'https://vjudge.net',
          'Referer': 'https://vjudge.net/',
        },
        body: new URLSearchParams({
          username,
          password,
        }).toString(),
      })

      const loginText = await loginResp.text()
      console.log(`[VJudge] Login response: ${loginText.substring(0, 200)}`)

      // 3. 直接检查登录 API 响应
      // VJudge 登录成功返回 "success"，失败返回错误信息
      const trimmedResponse = loginText.trim().toLowerCase()

      if (trimmedResponse === 'success' || loginText.includes('success')) {
        this.username = username
        console.log(`[VJudge] Login successful (API response): ${username}`)
        return {
          success: true,
          username: this.username,
        }
      }

      // 如果 API 返回了错误信息（包括 Cloudflare 人机验证拦截）
      if (loginText.includes('error') || loginText.includes('fail') || loginText.includes('invalid') ||
          loginText.includes('Human verification') || loginText.includes('human verification')) {
        const lowerMsg = loginText.toLowerCase()
        if (lowerMsg.includes('human verification') || lowerMsg.includes('cloudflare')) {
          return {
            success: false,
            message: 'CLOUDFLARE_BLOCKED: 被 Cloudflare 人机验证拦截，请使用 Cookie 方式绑定',
          }
        }
        return {
          success: false,
          message: `登录失败: ${loginText}`,
        }
      }

      // 其他情况，尝试验证登录状态（可能触发 Cloudflare）
      console.log('[VJudge] Step 3: Verifying login status (fallback)...')
      const verifyResult = await this.isLoggedIn()

      if (verifyResult.logged_in) {
        this.username = verifyResult.username || username
        console.log(`[VJudge] Login successful: ${this.username}`)
        return {
          success: true,
          username: this.username,
        }
      }

      return {
        success: false,
        message: verifyResult.reason || '登录失败',
      }
    } catch (err) {
      console.error('[VJudge] Login error:', err)
      return {
        success: false,
        message: `登录异常: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  /**
   * 检查是否已登录（通过访问首页判断）
   */
  async isLoggedIn(): Promise<LoginStatus> {
    try {
      const html = await this.get(VJUDGE_BASE_URL)

      // 方式1：检查页面中是否有 logout 链接
      if (html.includes('href="/user/logout"') ||
          html.includes('/user/logout') ||
          html.includes('"logout"')) {
        // 尝试提取当前用户名
        // VJudge 页面中通常有用户信息在 JSON 中
        const patterns = [
          /"username"\s*:\s*"([^"]+)"/,
          /"userName"\s*:\s*"([^"]+)"/,
          /user\/profile\/([^"'\s]+)/,
        ]

        for (const pattern of patterns) {
          const match = html.match(pattern)
          if (match) {
            return {
              logged_in: true,
              username: match[1],
            }
          }
        }

        return {
          logged_in: true,
          username: undefined,
        }
      }

      // 检查是否还在登录页
      if (html.includes('/user/login') && !html.includes('/user/logout')) {
        return {
          logged_in: false,
          reason: '未登录或会话已过期',
        }
      }

      // 检查是否被 Cloudflare 拦截
      if (html.includes('cf-browser-verification') ||
          html.includes('challenge-platform') ||
          html.includes('Just a moment') ||
          html.includes('Just a Moment') ||
          html.toLowerCase().includes('human verification')) {
        return {
          logged_in: false,
          reason: 'CLOUDFLARE_BLOCKED: 被 Cloudflare 人机验证拦截',
        }
      }

      // 保存调试信息
      console.log('[VJudge] Unknown page state, preview:', html.substring(0, 500))

      return {
        logged_in: false,
        reason: '无法确定登录状态',
      }
    } catch (err) {
      return {
        logged_in: false,
        reason: `检查登录状态失败: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  /**
   * 访问任意页面，返回 HTML
   */
  async get(url: string): Promise<string> {
    const response = await this.fetchWithRedirect(url)
    return response.text()
  }

  /**
   * 下载二进制资源（如头像图片），返回 Buffer
   * 使用与 get() 相同的 Cookie Jar
   */
  async getBinary(url: string): Promise<Buffer> {
    const response = await this.fetchWithRedirect(url)
    if (!response.ok) {
      throw new Error(`下载失败: HTTP ${response.status} ${url}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  /**
   * 获取当前用户名
   */
  getUsername(): string | null {
    return this.username
  }

  // ==================== 团队导入相关方法 ====================

  /**
   * 从 HTML 中提取 dataJson
   */
  private extractDataJson(html: string): any {
    try {
      // 匹配 <textarea name="dataJson">...</textarea>
      const match = html.match(/<textarea[^>]*name=["']dataJson["'][^>]*>([\s\S]*?)<\/textarea>/i)
      if (!match) {
        console.log('[VJudge] dataJson textarea not found')
        return null
      }
      // 解码 HTML 实体
      let raw = match[1].trim()
      // 处理常见的 HTML 实体
      raw = raw
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
      return JSON.parse(raw)
    } catch (err) {
      console.error('[VJudge] Failed to parse dataJson:', err)
      return null
    }
  }

  /**
   * 获取用户管理的团队列表
   */
  async getMyGroups(): Promise<VjudgeGroupItem[]> {
    try {
      console.log('[VJudge] Fetching my groups...')

      // 先检查 Cookie Jar 中有多少 cookie
      const allCookies = await this.jar.getCookies('https://vjudge.net')
      console.log('[VJudge] Cookie jar has', allCookies.length, 'cookies for vjudge.net')
      console.log('[VJudge] Cookie keys:', allCookies.map(c => c.key).join(', '))

      const html = await this.get('https://vjudge.net/group')

      // 检查HTML是否包含登录状态
      const hasLogout = html.includes('/user/logout')
      const hasLogoutItem = html.includes('logout-item')
      const hasLogin = html.includes('/user/login')
      const hasDropdown = html.includes('userNameDropdown')
      const isLoggedIn = hasLogout || hasLogoutItem || hasDropdown
      console.log('[VJudge] Page analysis: hasLogout=', hasLogout, 'hasLogoutItem=', hasLogoutItem, 'hasDropdown=', hasDropdown, 'hasLogin=', hasLogin)

      // 只有确定未登录 + Cloudflare 标记时才判断为拦截
      // VJudge 使用 Cloudflare CDN，正常页面也可能包含这些字符串
      if (!isLoggedIn && hasLogin) {
        // 确认在登录页 → 检查是否被 Cloudflare 拦截
        if (html.includes('Just a moment') || html.includes('cf-browser-verification') ||
            html.includes('challenge-platform') || html.includes('Human verification')) {
          console.log('[VJudge] Blocked by Cloudflare!')
          throw new Error('CLOUDFLARE_BLOCKED: 被 Cloudflare 人机验证拦截，请重新获取 Cookie')
        }
        console.log('[VJudge] Not logged in, but not Cloudflare blocked')
        return []
      }

      const data = this.extractDataJson(html)

      if (!data) {
        console.log('[VJudge] No dataJson found in group page')
        // 打印HTML前500字符用于调试
        console.log('[VJudge] HTML preview:', html.substring(0, 500))
        return []
      }

      // data.myGroups 包含用户管理的团队
      const groups: VjudgeGroupItem[] = []
      const myGroups = data.myGroups || []

      for (const g of myGroups) {
        groups.push({
          groupId: g.shortName || g.short_name,
          groupName: g.name
        })
      }

      console.log(`[VJudge] Found ${groups.length} groups`)
      return groups
    } catch (err) {
      console.error('[VJudge] Failed to get my groups:', err)
      return []
    }
  }

  /**
   * 获取团队详情（包含成员）
   */
  async getGroupDetails(shortName: string): Promise<VjudgeGroupDetails | null> {
    try {
      console.log(`[VJudge] Fetching group details: ${shortName}`)
      const html = await this.get(`https://vjudge.net/group/${shortName}`)

      // 检查是否被 Cloudflare 拦截（只有页面不包含正常内容时才判断）
      const hasTitle = html.includes('<title>') && !html.toLowerCase().includes('just a moment')
      if (!hasTitle) {
        throw new Error('CLOUDFLARE_BLOCKED: 被 Cloudflare 人机验证拦截，请重新获取 Cookie')
      }

      const data = this.extractDataJson(html)

      if (!data) {
        console.log('[VJudge] No dataJson found in group detail page')
        return null
      }

      // 团队基本信息
      const groupName = (data.name || '').trim()
      const groupDescription = (data.brief || '').trim()

      // 公告：在 intro.content 中
      const intro = data.intro || {}
      const announcement = typeof intro === 'object' ? (intro.content || '').trim() : ''

      // 成员列表：memberBriefs
      const members: VjudgeMember[] = []
      const memberBriefs = data.memberBriefs || []
      for (const m of memberBriefs) {
        members.push({
          username: (m.username || '').trim(),
          nickname: (m.nickName || m.nickname || '').trim()
        })
      }

      // 团队头像：优先取 <img id="group-logo">，兜底取 og:image
      let avatarUrl = ''
      const logoMatch = html.match(/<img[^>]*id=["']group-logo["'][^>]*src=["']([^"']+)["']/i)
      if (logoMatch) {
        avatarUrl = logoMatch[1].trim()
      } else {
        const ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
        if (ogMatch) {
          avatarUrl = new URL(ogMatch[1].trim(), 'https://vjudge.net/').toString()
        }
      }

      console.log(`[VJudge] Group "${groupName}" has ${members.length} members, avatar: ${avatarUrl ? 'yes' : 'no'}`)

      return {
        groupId: shortName,
        groupName,
        groupDescription,
        announcement,
        avatarUrl,
        members
      }
    } catch (err) {
      console.error('[VJudge] Failed to get group details:', err)
      return null
    }
  }
}
