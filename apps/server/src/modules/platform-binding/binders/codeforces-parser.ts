/**
 * Codeforces HTML Parser
 * Codeforces 页面 HTML 解析器
 */

import { logger } from '../../../lib/logger'

/**
 * Codeforces 用户信息
 */
export interface CfUserInfo {
  /** 是否已登录 */
  loggedIn: boolean
  /** 用户 handle（用户名） */
  handle: string | null
  /** 用户显示名（可能不同于 handle） */
  displayName: string | null
  /** 当前 rating */
  rating: number | null
  /** 最高 rating */
  maxRating: number | null
  /** 段位（如 pupil, expert 等） */
  rank: string | null
  /** 头像 URL */
  avatar: string | null
  /** 失败原因 */
  reason?: string
}

/**
 * 检查 Codeforces 登录状态
 * 参考 Hydro 实现：检查 header-bell__img 元素是否存在
 *
 * @param html - 页面 HTML
 * @returns 是否已登录
 */
export function checkCfLoginStatus(html: string): boolean {
  // Hydro 使用 header-bell__img 检查登录状态
  if (html.includes('header-bell__img')) {
    return true
  }

  // 备选检查：查找用户头像区域
  // 登录后会显示用户头像和 handle
  if (html.includes('user-avatar') || html.includes('rated-user')) {
    return true
  }

  // 检查是否有登出链接
  if (html.includes('/logout')) {
    return true
  }

  return false
}

/**
 * 从 Codeforces 首页解析用户信息
 *
 * @param html - 首页 HTML
 * @returns 用户信息
 */
export function parseCfUserProfile(html: string): CfUserInfo {
  // 1. 检查登录状态
  const loggedIn = checkCfLoginStatus(html)

  if (!loggedIn) {
    return {
      loggedIn: false,
      handle: null,
      displayName: null,
      rating: null,
      maxRating: null,
      rank: null,
      avatar: null,
      reason: 'Cookie 无效或未登录',
    }
  }

  // 2. 解析用户 handle
  // Codeforces 首页登录后，用户信息在侧边栏或顶部导航
  // 查找类似 <a href="/profile/handle" class="rated-user ...">handle</a> 的元素

  let handle: string | null = null
  let rating: number | null = null
  let maxRating: number | null = null
  let rank: string | null = null
  let avatar: string | null = null
  let displayName: string | null = null

  try {
    // 方法1：从 profile 链接提取 handle
    const profileMatch = html.match(/href="\/profile\/([^"]+)"/)
    if (profileMatch) {
      handle = profileMatch[1]
    }

    // 方法2：从 rated-user 类提取
    if (!handle) {
      const ratedUserMatch = html.match(/class="rated-user[^"]*"[^>]*>([^<]+)</)
      if (ratedUserMatch) {
        handle = ratedUserMatch[1].trim()
      }
    }

    // 方法3：从用户菜单提取
    if (!handle) {
      // 查找 <div class="lang-chooser"> 或用户下拉菜单
      const userMenuMatch = html.match(/<a[^>]*href="\/profile\/[^"]*"[^>]*>([^<]+)<\/a>/)
      if (userMenuMatch) {
        handle = userMenuMatch[1].trim()
      }
    }

    // 3. 解析 rating
    // Codeforces 在用户名旁边显示 rating，格式如 "handle (1234)"
    const ratingMatch = html.match(/<span[^>]*class="[^"]*user-[^"]*"[^>]*>(\d+)<\/span>/)
    if (ratingMatch) {
      rating = parseInt(ratingMatch[1], 10)
    }

    // 备选：从 profile 页面数据提取
    // 有时 rating 信息在 JavaScript 变量中
    const ratingVarMatch = html.match(/"rating"\s*:\s*(\d+)/)
    if (ratingVarMatch && !rating) {
      rating = parseInt(ratingVarMatch[1], 10)
    }

    // 4. 解析段位（rank）
    // 段位信息在 class 中，如 user-cyan, user-blue, user-violet 等
    const rankClassMatch = html.match(/class="[^"]*user-(cyan|blue|violet|orange|red|yellow|gray|green)[^"]*"/)
    if (rankClassMatch) {
      // 映射颜色到段位名
      const colorToRank: Record<string, string> = {
        'gray': 'Newbie',
        'green': 'Pupil',
        'cyan': 'Specialist',
        'blue': 'Expert',
        'violet': 'Candidate Master',
        'orange': 'Master',
        'red': 'Grandmaster',
        'yellow': 'Legendary Grandmaster',
      }
      rank = colorToRank[rankClassMatch[1]] || rankClassMatch[1]
    }

    // 5. 解析头像
    const avatarMatch = html.match(/src="([^"]*\/avatar\/[^"]*)"/)
    if (avatarMatch) {
      avatar = avatarMatch[1]
      // 补全 URL
      if (avatar.startsWith('//')) {
        avatar = 'https:' + avatar
      } else if (avatar.startsWith('/')) {
        avatar = 'https://codeforces.com' + avatar
      }
    }

    // 6. 解析显示名（如果有）
    // 显示名通常在 title 属性或单独的元素中
    const displayNameMatch = html.match(/title="([^"]+)"[^>]*class="[^"]*rated-user/)
    if (displayNameMatch) {
      displayName = displayNameMatch[1]
    }

  } catch (error) {
    logger.error('[CF Parser] Error parsing user profile', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      loggedIn: true,
      handle: null,
      displayName: null,
      rating: null,
      maxRating: null,
      rank: null,
      avatar: null,
      reason: '解析用户信息失败',
    }
  }

  if (!handle) {
    return {
      loggedIn: true,
      handle: null,
      displayName: null,
      rating: null,
      maxRating: null,
      rank: null,
      avatar: null,
      reason: '无法解析用户名',
    }
  }

  return {
    loggedIn: true,
    handle,
    displayName,
    rating,
    maxRating,
    rank,
    avatar,
  }
}

/**
 * 从 Codeforces 用户设置页面解析更详细的用户信息
 * 访问 https://codeforces.com/settings/profile 可以获取更完整的信息
 *
 * @param html - 设置页面 HTML
 * @returns 用户信息
 */
export function parseCfSettingsPage(html: string): Partial<CfUserInfo> {
  const result: Partial<CfUserInfo> = {}

  try {
    // 从设置页面提取 handle
    const handleMatch = html.match(/name="handle"[^>]*value="([^"]+)"/)
    if (handleMatch) {
      result.handle = handleMatch[1]
    }

    // 提取显示名
    const displayNameMatch = html.match(/name="firstName"[^>]*value="([^"]+)"/)
    if (displayNameMatch) {
      result.displayName = displayNameMatch[1]
    }

  } catch (error) {
    logger.error('[CF Parser] Error parsing settings page', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return result
}

/**
 * 从提交页面解析提交记录
 * 用于后续获取用户提交记录
 *
 * @param html - 提交列表页面 HTML
 * @returns 提交记录列表
 */
export interface CfSubmission {
  id: string
  problemId: string
  problemName: string
  verdict: string
  time: string
  memory: string
  language: string
  submittedAt: string
}

export function parseCfSubmissionList(html: string): CfSubmission[] {
  const submissions: CfSubmission[] = []

  try {
    // 提交记录在 table 中，每行一个提交
    // 简单实现：使用正则提取关键信息
    // 完整实现需要使用 cheerio 或类似库

    // 匹配提交行
    const rowPattern = /<tr[^>]*data-submission-id="(\d+)"[^>]*>[\s\S]*?<\/tr>/g
    let match

    while ((match = rowPattern.exec(html)) !== null) {
      const rowHtml = match[0]
      const submissionId = match[1]

      // 提取题号
      const problemMatch = rowHtml.match(/\/problem\/(\d+\/[A-Z])/)
      const problemId = problemMatch ? problemMatch[1] : ''

      // 提取评测结果
      const verdictMatch = rowHtml.match(/class="[^"]*submissionVerdict[^"]*"[^>]*>([^<]+)</)
      const verdict = verdictMatch ? verdictMatch[1].trim() : ''

      // 提取语言
      const langMatch = rowHtml.match(/class="[^"]*language[^"]*"[^>]*>([^<]+)</)
      const language = langMatch ? langMatch[1].trim() : ''

      submissions.push({
        id: submissionId,
        problemId,
        problemName: '',
        verdict,
        time: '',
        memory: '',
        language,
        submittedAt: '',
      })
    }

  } catch (error) {
    logger.error('[CF Parser] Error parsing submission list', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return submissions
}
