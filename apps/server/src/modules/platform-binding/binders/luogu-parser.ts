/**
 * Luogu Parser - 解析层
 * 前提：已经拿到真实页面 HTML
 *
 * 职责：
 * 1. 提取 _feInjection 数据
 * 2. 解析 currentUser 获取用户名和 UID
 * 3. 处理不同的页面类型
 */

/**
 * 洛谷用户信息
 */
export interface LuoguUserInfo {
  /** 是否已登录 */
  logged_in: boolean
  /** 用户名 */
  username?: string
  /** UID */
  uid?: string
  /** 错误原因 */
  reason?: string
}

/**
 * _feInjection 数据结构（部分字段）
 */
interface FeInjectionData {
  currentUser: {
    uid: number
    name: string
    slogan?: string
    badge?: string
    ranking?: number
    isAdmin?: boolean
    isBanned?: boolean
  } | null
  [key: string]: any
}

/**
 * 从 HTML 中提取 _feInjection 数据
 *
 * @param html - 页面 HTML
 * @returns 解析后的数据对象，失败返回 null
 */
export function extractFeInjection(html: string): FeInjectionData | null {
  const marker = 'window._feInjection = JSON.parse(decodeURIComponent("'
  const pos = html.indexOf(marker)
  if (pos === -1) {
    return null
  }

  const start = pos + marker.length
  const end = html.indexOf('"))', start)
  if (end === -1) {
    return null
  }

  try {
    const encoded = html.substring(start, end)
    const decoded = decodeURIComponent(encoded)
    const data = JSON.parse(decoded)

    if (typeof data !== 'object' || data === null) {
      return null
    }

    return data as FeInjectionData
  } catch (err) {
    // 解析失败
    return null
  }
}

/**
 * 解析洛谷用户信息
 *
 * @param html - 真实首页 HTML（已通过挑战页）
 * @returns 用户信息
 */
export function parseUserInfo(html: string): LuoguUserInfo {
  // 1. 提取 _feInjection 数据
  const data = extractFeInjection(html)
  if (!data) {
    return {
      logged_in: false,
      reason: '无法解析页面数据，可能是页面结构变化',
    }
  }

  // 2. 获取 currentUser
  const user = data.currentUser

  // 3. currentUser 为 null 表示未登录或 Cookie 已失效
  if (user === null) {
    return {
      logged_in: false,
      reason: 'currentUser 为 null，未登录或 Cookie 已失效',
    }
  }

  // 4. currentUser 不是对象，页面结构异常
  if (typeof user !== 'object') {
    return {
      logged_in: false,
      reason: 'currentUser 格式异常，期望对象但得到 ' + typeof user,
    }
  }

  // 5. 检查必要字段
  if (user.uid === undefined || user.name === undefined) {
    return {
      logged_in: false,
      reason: 'currentUser 缺少必要字段（uid 或 name）',
    }
  }

  // 6. 检查账号是否被封禁
  if (user.isBanned) {
    return {
      logged_in: false,
      reason: '账号已被封禁',
    }
  }

  // 7. 返回用户信息
  return {
    logged_in: true,
    username: user.name,
    uid: String(user.uid),
  }
}

/**
 * 验证 HTML 是否为真实首页
 * （与 fetcher 中的 isRealHomepage 功能相同，供 parser 独立使用）
 */
export function isValidHomepage(html: string): boolean {
  return html.includes('window._feInjection = JSON.parse(decodeURIComponent("')
}