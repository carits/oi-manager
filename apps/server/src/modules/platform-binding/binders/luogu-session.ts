/**
 * Luogu Session - 洛谷会话服务
 *
 * 职责：
 * 1. 从数据库绑定数据构建会话（Cookie 鉴权）
 * 2. 获取用户管理的团队列表
 * 3. 获取团队详情（公告 + 成员）
 *
 * 参考 Python 脚本：
 * - luogu.py — 首页请求 + C3VK 处理
 * - luogu_group_list.py — 团队列表
 * - luogu_announcement.py — 团队公告
 * - luogu_group_,member.py — 团队成员
 *
 * QPS 控制：所有对洛谷的请求都经过速率限制和随机抖动，
 * 避免触发洛谷的反爬机制。
 */

import { prisma } from '../../../prisma'
import logger from '../../../lib/logger'
import {
  buildHeaders,
  cookiesToString,
  parseCookieString,
  isChallengePage,
  isRealHomepage,
  extractC3VK,
  extractCookiesFromResponse,
} from './luogu-fetcher'

/** QPS 限速器 - 确保请求之间有最小间隔 + 随机抖动 */
class RateLimiter {
  private lastRequestTime = 0
  private queue: Array<() => void> = []
  private processing = false

  constructor(
    private minInterval: number = 1500,
    private jitterRange: [number, number] = [500, 1500]
  ) {}

  private getWaitTime(): number {
    const now = Date.now()
    const elapsed = now - this.lastRequestTime
    const jitter = this.jitterRange[0] + Math.random() * (this.jitterRange[1] - this.jitterRange[0])
    return Math.max(0, this.minInterval - elapsed) + jitter
  }

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn()
          resolve(result)
        } catch (err) {
          reject(err)
        }
      })
      this.processQueue()
    })
  }

  private async processQueue() {
    if (this.processing) return
    this.processing = true

    while (this.queue.length > 0) {
      const item = this.queue.shift()!
      const waitTime = this.getWaitTime()
      if (waitTime > 0) {
        await new Promise(r => setTimeout(r, waitTime))
      }
      this.lastRequestTime = Date.now()
      await item()
    }

    this.processing = false
  }
}

/** 全局洛谷请求限速器 */
const luoguRateLimiter = new RateLimiter(1500, [500, 1500])

/** 洛谷团队列表项 */
export interface LuoguGroupItem {
  id: string
  name: string
}

/** 洛谷团队详情 */
export interface LuoguGroupDetails {
  groupId: string
  groupName: string
  announcement?: string
  members: Array<{
    username: string
    uid: string
    realName: string
  }>
}

const LUOGU_BASE = 'https://www.luogu.com.cn'

export class LuoguSession {
  private clientId: string
  private uidCookie: string
  private extraCookies: Record<string, string> = {}

  private constructor(clientId: string, uidCookie: string) {
    this.clientId = clientId
    this.uidCookie = uidCookie
  }

  /**
   * 从数据库绑定数据构建会话
   */
  static async fromBinding(userId: string): Promise<LuoguSession | null> {
    const binding = await prisma.userPlatformBinding.findUnique({
      where: {
        userId_platform: {
          userId,
          platform: 'luogu'
        }
      }
    })

    if (!binding || binding.bindingStatus !== 'bound' || !binding.bindingData) {
      return null
    }

    try {
      const data = JSON.parse(binding.bindingData)
      if (!data.clientId || !data.uidCookie) {
        logger.error('luogu_session_binding_data_missing', { action: 'luogu_session_fromBinding', metadata: { detail: 'bindingData missing clientId/uidCookie' } })
        return null
      }
      return new LuoguSession(data.clientId, data.uidCookie)
    } catch (err) {
      logger.error('luogu_session_parse_binding_failed', err, { action: 'luogu_session_fromBinding' })
      return null
    }
  }

  /** 构建 Cookie 字符串 */
  private buildCookieString(): string {
    const cookies: Record<string, string> = {
      '__client_id': this.clientId,
      '_uid': this.uidCookie,
      ...this.extraCookies
    }
    return cookiesToString(cookies)
  }

  /**
   * 带限速的 HTTP GET 请求，手动处理重定向
   *
   * Node.js 的 fetch 在 redirect:'follow' 模式下不会把 Cookie
   * 带入重定向请求，导致洛谷无限重定向（redirect count exceeded）。
   * 所以必须用 redirect:'manual' + 手动跟随，模拟 Python requests.Session 的行为。
   */
  private async throttledGet(url: string, extraHeaders?: Record<string, string>, maxRedirects: number = 10): Promise<Response> {
    return luoguRateLimiter.acquire(async () => {
      let currentUrl = url
      for (let i = 0; i < maxRedirects; i++) {
        const cookieString = this.buildCookieString()
        const response = await fetch(currentUrl, {
          method: 'GET',
          headers: {
            ...buildHeaders(),
            ...extraHeaders,
            'Cookie': cookieString,
          },
          redirect: 'manual',
        })

        // 收集响应 Cookie
        const respCookies = extractCookiesFromResponse(response)
        Object.assign(this.extraCookies, respCookies)

        const status = response.status
        if (status >= 300 && status < 400) {
          const location = response.headers.get('location')
          if (location) {
            currentUrl = new URL(location, currentUrl).toString()
            continue
          }
        }

        return response
      }
      throw new Error(`请求 ${url} 重定向超过 ${maxRedirects} 次`)
    })
  }

  /**
   * 从响应中提取 C3VK（优先从 Set-Cookie 响应头，备用从 HTML）
   * 参考 Python: pick_c3vk_from_response() + extract_c3vk()
   */
  private pickC3VK(response: Response, html?: string): string | null {
    // 优先从响应 Set-Cookie 获取
    const responseCookies = extractCookiesFromResponse(response)
    Object.assign(this.extraCookies, responseCookies)
    if (responseCookies['C3VK']) {
      return responseCookies['C3VK']
    }

    // 备用：从 HTML 中提取
    if (html) {
      return extractC3VK(html)
    }
    return null
  }

  /**
   * 请求洛谷页面，自动处理 C3VK 挑战
   * 参考 Python: luogu.py 的 get_luogu_user_info() 和 luogu_announcement.py
   *
   * 策略：两次请求
   * - 第一次：拿 C3VK（从 Set-Cookie 或 HTML）
   * - 第二次：带 C3VK 拿真实页面
   */
  private async fetchPage(url: string, maxRetries: number = 5): Promise<string> {
    for (let round = 0; round < maxRetries; round++) {
      const response = await this.throttledGet(url)
      const html = await response.text()

      // 已经是真实页面
      if (isRealHomepage(html)) {
        return html
      }

      // C3VK 挑战页：提取 C3VK，重试
      if (isChallengePage(html)) {
        const c3vk = this.pickC3VK(response, html)
        if (c3vk) {
          logger.info('luogu_session_c3vk_challenge', { action: 'luogu_fetchPage', metadata: { round: round + 1 } })
          this.extraCookies['C3VK'] = c3vk
          continue
        }
      }

      // 非 C3VK 挑战也非真实页面（可能是 lentille-context 页面等）
      // 尝试提取 C3VK 后重试一次
      const c3vk = this.pickC3VK(response, html)
      if (c3vk && !this.extraCookies['C3VK']) {
        this.extraCookies['C3VK'] = c3vk
        continue
      }

      // 直接返回让调用方解析
      return html
    }

    throw new Error(`C3VK 挑战处理失败：重试 ${maxRetries} 次后仍未成功`)
  }

  /**
   * HTML 实体解码（等价于 Python 的 html.unescape）
   */
  private htmlUnescape(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&apos;/g, "'")
  }

  /**
   * 从 HTML 中提取页面数据
   * 按优先级尝试三种格式：
   * 1. 直接 JSON（X-Lentille-Request 响应）
   * 2. lentille-context script 标签（团队页面格式）
   * 3. _feInjection（首页格式）
   *
   * 参考 Python: parse_payload() + extract_lentille_context()
   */
  private extractPageData(html: string): any {
    // 1. 直接 JSON
    try {
      const data = JSON.parse(html)
      if (typeof data === 'object' && data !== null) {
        return data
      }
    } catch {
      // 不是 JSON
    }

    // 2. lentille-context（团队页面常用格式，参考 luogu_announcement.py）
    const lcPatterns = [
      /<script\s+id="lentille-context"\s+type="application\/json">\s*([\s\S]*?)\s*<\/script>/,
      /<script\s+id='lentille-context'\s+type="application\/json">\s*([\s\S]*?)\s*<\/script>/,
    ]
    for (const pat of lcPatterns) {
      const m = html.match(pat)
      if (m) {
        const raw = this.htmlUnescape(m[1].trim())
        try {
          return JSON.parse(raw)
        } catch (err) {
          logger.error('luogu_session_lentille_parse_failed', undefined, { action: 'luogu_extractPageData', metadata: { detail: err instanceof Error ? err.message : String(err) } })
        }
      }
    }

    // 3. _feInjection（首页格式，参考 luogu.py 的 extract_fe_injection_data）
    const feMarker = 'window._feInjection = JSON.parse(decodeURIComponent("'
    const fePos = html.indexOf(feMarker)
    if (fePos !== -1) {
      const start = fePos + feMarker.length
      const end = html.indexOf('"))', start)
      if (end !== -1) {
        const encoded = html.substring(start, end)
        try {
          const decoded = decodeURIComponent(encoded)
          const feData = JSON.parse(decoded)
          // _feInjection 中数据在 currentData 下，统一转为 data 格式
          if (feData.currentData) {
            return { data: feData.currentData }
          }
          return feData
        } catch (err) {
          logger.error('luogu_session_feinjection_parse_failed', undefined, { action: 'luogu_extractPageData', metadata: { detail: err instanceof Error ? err.message : String(err) } })
        }
      }
    }

    // 调试：输出 HTML 前缀帮助排查
    logger.error('luogu_session_no_data_in_html', undefined, { action: 'luogu_extractPageData', metadata: { preview: html.substring(0, 500) } })
    throw new Error('页面中未找到数据（未匹配 lentille-context / _feInjection / JSON 格式）')
  }

  // ── 团队列表 ──
  // 参考 luogu_group_list.py：先尝试 JSON API，再尝试 HTML

  async getMyGroups(): Promise<LuoguGroupItem[]> {
    const url = `${LUOGU_BASE}/user/mine/team`

    // 策略1：JSON API（参考 luogu_group_list.py 的 fetch_json_way）
    try {
      const response = await this.throttledGet(url, {
        'Accept': 'application/json, text/plain, */*',
        'X-Lentille-Request': 'content-only',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `${LUOGU_BASE}/`,
      })

      if (response.ok) {
        const text = await response.text()
        try {
          const data = JSON.parse(text)
          const teams = this.parseTeamList(data)
          if (teams.length > 0) return teams
        } catch {
          // JSON 解析失败
        }
      }
    } catch (err) {
      logger.warn('luogu_session_team_list_json_failed', { action: 'luogu_getMyGroups', metadata: { detail: err instanceof Error ? err.message : String(err) } })
    }

    // 策略2：HTML 页面（参考 luogu_group_list.py 的 fetch_html_way）
    const html = await this.fetchPage(url)
    const data = this.extractPageData(html)
    return this.parseTeamList(data)
  }

  private parseTeamList(data: any): LuoguGroupItem[] {
    const teams = data?.data?.teams || []
    const result: LuoguGroupItem[] = []

    for (const item of teams) {
      const team = item?.team
      if (team && team.id && team.name) {
        result.push({
          id: String(team.id),
          name: team.name,
        })
      }
    }

    return result
  }

  // ── 团队详情（公告 + 成员）──
  // 参考 luogu_announcement.py + luogu_group_,member.py

  async getGroupDetails(teamId: string): Promise<LuoguGroupDetails | null> {
    // 1. 获取团队页面（公告）
    //    参考 luogu_announcement.py：fetch_team_name_and_notice()
    const teamHtml = await this.fetchPage(`${LUOGU_BASE}/team/${teamId}`)
    const teamData = this.extractPageData(teamHtml)

    const data = teamData?.data || {}
    const team = data.team
    if (!team) {
      throw new Error('团队页面解析失败：未找到团队数据')
    }
    const groupName = team.name || ''
    const announcement = data.notice || undefined

    // 2. 获取成员列表
    //    参考 luogu_group_,member.py：fetch_members()
    const members = await this.fetchMembers(teamId)

    return {
      groupId: teamId,
      groupName,
      announcement,
      members,
    }
  }

  /**
   * 获取团队成员列表
   * 参考 luogu_group_,member.py 的 fetch_members()
   */
  private async fetchMembers(teamId: string): Promise<LuoguGroupDetails['members']> {
    const url = `${LUOGU_BASE}/team/${teamId}/member`

    // 策略1：JSON API（参考 fetch_members 的 JSON 方式）
    try {
      const response = await this.throttledGet(url, {
        'Accept': 'application/json, text/plain, */*',
        'X-Lentille-Request': 'content-only',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': url,
      })

      if (response.ok) {
        const text = await response.text()
        try {
          const data = JSON.parse(text)
          const members = this.parseMemberList(data)
          if (members.length > 0) return members
        } catch {
          // 解析失败
        }
      }
    } catch (err) {
      logger.warn('luogu_session_member_json_failed', { action: 'luogu_fetchMembers', metadata: { detail: err instanceof Error ? err.message : String(err) } })
    }

    // 策略2：HTML 页面方式
    const html = await this.fetchPage(url)
    const data = this.extractPageData(html)
    return this.parseMemberList(data)
  }

  private parseMemberList(data: any): LuoguGroupDetails['members'] {
    const d = data?.data || {}
    const result = d.members?.result || d.result || []
    const members: LuoguGroupDetails['members'] = []

    for (const item of result) {
      const user = item?.user
      if (user && user.name) {
        members.push({
          username: user.name,
          uid: String(user.uid || ''),
          realName: item.realName || '',
        })
      }
    }

    return members
  }
}
