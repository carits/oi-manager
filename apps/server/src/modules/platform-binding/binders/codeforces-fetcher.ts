/**
 * Codeforces Fetcher
 * Codeforces 页面请求封装，使用 Playwright 绕过 Cloudflare
 */

import { logger } from '../../../lib/logger'
import { fetchPageHtml, withPlaywright, type PlaywrightCookie, type PlaywrightOptions } from '../../../lib/playwright-helper'
import { parseCfUserProfile, checkCfLoginStatus, type CfUserInfo } from './codeforces-parser'

/**
 * Codeforces 域名
 */
export const CF_DOMAIN = 'codeforces.com'

/**
 * Codeforces URL 列表
 */
export const CF_URLS = {
  home: 'https://codeforces.com/',
  profile: (handle: string) => `https://codeforces.com/profile/${handle}`,
  settings: 'https://codeforces.com/settings/profile',
  submissions: (handle: string) => `https://codeforces.com/submissions/${handle}`,
  api: {
    userInfo: (handles: string) => `https://codeforces.com/api/user.info?handles=${handles}`,
    userStatus: (handle: string) => `https://codeforces.com/api/user.status?handle=${handle}`,
  },
}

/**
 * 构建 Codeforces Cookie
 */
export function buildCfCookies(jsessionid: string): PlaywrightCookie[] {
  return [
    {
      name: 'JSESSIONID',
      value: jsessionid,
      domain: CF_DOMAIN,
      path: '/',
    },
  ]
}

/**
 * 从 Cookie 字符串解析 JSESSIONID
 */
export function parseJsessionId(cookieString: string): string | null {
  // 支持多种格式
  // 格式1: JSESSIONID=xxx
  // 格式2: JSESSIONID=xxx; other=yyy
  const match = cookieString.match(/JSESSIONID=([^;]+)/i)
  return match ? match[1] : null
}

/**
 * 获取 Codeforces 首页并解析用户信息
 *
 * @param jsessionid - JSESSIONID Cookie 值
 * @param options - Playwright 选项
 * @returns 用户信息
 */
export async function fetchCfUserInfo(
  jsessionid: string,
  options: PlaywrightOptions = {}
): Promise<CfUserInfo> {
  const cookies = buildCfCookies(jsessionid)

  try {
    logger.info('[CF Fetcher] Fetching user info from Codeforces homepage', {
      jsessionidLength: jsessionid.length,
    })

    const html = await fetchPageHtml(CF_URLS.home, cookies, {
      ...options,
      debug: options.debug ?? false,
    })

    const userInfo = parseCfUserProfile(html)

    logger.info('[CF Fetcher] User info parsed', {
      loggedIn: userInfo.loggedIn,
      handle: userInfo.handle,
      rating: userInfo.rating,
    })

    return userInfo

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('[CF Fetcher] Error fetching user info', { error: errorMessage })

    return {
      loggedIn: false,
      handle: null,
      displayName: null,
      rating: null,
      maxRating: null,
      rank: null,
      avatar: null,
      reason: `请求失败: ${errorMessage}`,
    }
  }
}

/**
 * 获取 Codeforces 用户资料页
 *
 * @param jsessionid - JSESSIONID Cookie 值
 * @param handle - 用户 handle
 * @param options - Playwright 选项
 * @returns HTML 内容
 */
export async function fetchCfProfilePage(
  jsessionid: string,
  handle: string,
  options: PlaywrightOptions = {}
): Promise<string> {
  const cookies = buildCfCookies(jsessionid)

  return fetchPageHtml(CF_URLS.profile(handle), cookies, options)
}

/**
 * 获取 Codeforces 用户提交列表页
 *
 * @param jsessionid - JSESSIONID Cookie 值
 * @param handle - 用户 handle
 * @param options - Playwright 选项
 * @returns HTML 内容
 */
export async function fetchCfSubmissionsPage(
  jsessionid: string,
  handle: string,
  options: PlaywrightOptions = {}
): Promise<string> {
  const cookies = buildCfCookies(jsessionid)

  return fetchPageHtml(CF_URLS.submissions(handle), cookies, options)
}

/**
 * 使用 Codeforces API 获取用户信息（无需认证）
 * 这是备选方案，不需要 Cookie
 *
 * @param handle - 用户 handle
 * @returns 用户信息
 */
export async function fetchCfUserInfoByApi(handle: string): Promise<{
  success: boolean
  handle?: string
  rating?: number
  maxRating?: number
  rank?: string
  avatar?: string
  error?: string
}> {
  try {
    const response = await fetch(CF_URLS.api.userInfo(handle))

    if (!response.ok) {
      return {
        success: false,
        error: `API 请求失败: ${response.status}`,
      }
    }

    const data = await response.json()

    if (data.status !== 'OK' || !data.result || data.result.length === 0) {
      return {
        success: false,
        error: '用户不存在',
      }
    }

    const user = data.result[0]

    return {
      success: true,
      handle: user.handle,
      rating: user.rating,
      maxRating: user.maxRating,
      rank: user.rank,
      avatar: user.avatar ? `https:${user.avatar}` : undefined,
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      error: `API 请求失败: ${errorMessage}`,
    }
  }
}

/**
 * 检查 JSESSIONID 是否有效
 *
 * @param jsessionid - JSESSIONID Cookie 值
 * @returns 是否有效
 */
export async function validateCfJsessionId(
  jsessionid: string
): Promise<{ valid: boolean; handle?: string; reason?: string }> {
  const userInfo = await fetchCfUserInfo(jsessionid)

  if (!userInfo.loggedIn) {
    return {
      valid: false,
      reason: userInfo.reason || 'Cookie 无效或已过期',
    }
  }

  if (!userInfo.handle) {
    return {
      valid: false,
      reason: '无法解析用户名',
    }
  }

  return {
    valid: true,
    handle: userInfo.handle,
  }
}
