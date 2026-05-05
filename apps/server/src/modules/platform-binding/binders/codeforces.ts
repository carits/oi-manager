/**
 * Codeforces Platform Binder
 * Codeforces 平台绑定器
 *
 * 使用 Cookie 方式绑定 Codeforces 账号
 * 需要用户提供 JSESSIONID Cookie
 */

import type { PlatformBinder } from './types'
import { fetchCfUserInfo, validateCfJsessionId, parseJsessionId } from './codeforces-fetcher'
import { logger } from '../../../lib/logger'

/**
 * Codeforces 专属配置
 */
interface CfConfig {
  JSESSIONID: string
}

/**
 * Codeforces 绑定数据（存储在 bindingData 中）
 */
interface CfBindingData {
  jsessionid: string      // JSESSIONID Cookie
  handle: string          // CF handle（用户名）
  rating: number | null   // 当前 rating
  rank: string | null     // 段位
  verifiedAt: string      // 验证时间
}

/**
 * 判断是否为有效的 Codeforces 配置
 */
function isValidConfig(extra: Record<string, any> | undefined): extra is CfConfig {
  if (!extra) return false
  return typeof extra.JSESSIONID === 'string' && extra.JSESSIONID.length > 0
}

/**
 * Codeforces 平台绑定器
 */
export class CodeforcesBinder implements PlatformBinder {
  platform = 'codeforces' as const

  async validateUsername(username: string): Promise<{ valid: boolean; message?: string }> {
    // Codeforces 用户名验证：至少 1 个字符
    if (!username || username.length < 1) {
      return { valid: false, message: '请输入 Codeforces 用户名' }
    }

    // Codeforces 用户名格式：字母、数字、下划线、点
    const validPattern = /^[a-zA-Z0-9_.]+$/
    if (!validPattern.test(username)) {
      return { valid: false, message: 'Codeforces 用户名只能包含字母、数字、下划线和点' }
    }

    return { valid: true }
  }

  async bind(params: {
    username: string
    password?: string
    extra?: Record<string, any>
  }): Promise<{
    success: boolean
    message?: string
    platformUsername?: string
    bindingData?: string
  }> {
    // 1. 验证平台专属配置
    if (!isValidConfig(params.extra)) {
      return {
        success: false,
        message: '请提供有效的 Codeforces Cookie：JSESSIONID',
      }
    }

    const config = params.extra as CfConfig
    const jsessionid = config.JSESSIONID.trim()

    logger.info('[CF Binder] Starting bind process', {
      jsessionidLength: jsessionid.length,
    })

    try {
      // 2. 验证 JSESSIONID 并获取用户信息
      const userInfo = await fetchCfUserInfo(jsessionid)

      // 3. 检查登录状态
      if (!userInfo.loggedIn) {
        return {
          success: false,
          message: userInfo.reason || 'Cookie 无效或未登录',
        }
      }

      // 4. 检查是否成功解析 handle
      if (!userInfo.handle) {
        return {
          success: false,
          message: '无法解析 Codeforces 用户名，请确认 Cookie 正确',
        }
      }

      // 5. 绑定成功（存储 Cookie 供后续使用）
      const bindingData: CfBindingData = {
        jsessionid,
        handle: userInfo.handle,
        rating: userInfo.rating,
        rank: userInfo.rank,
        verifiedAt: new Date().toISOString(),
      }

      logger.info('[CF Binder] Bind successful', {
        handle: userInfo.handle,
        rating: userInfo.rating,
      })

      return {
        success: true,
        message: '绑定成功',
        platformUsername: userInfo.handle,
        bindingData: JSON.stringify(bindingData),
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('[CF Binder] Bind error', { error: errorMessage })

      return {
        success: false,
        message: `绑定失败: ${errorMessage}`,
      }
    }
  }

  async unbind(userId: string): Promise<{ success: boolean; message?: string }> {
    // Codeforces 解绑只需要清除本地记录，无需调用远程 API
    logger.info('[CF Binder] Unbind requested', { userId })
    return { success: true }
  }

  async refresh(userId: string): Promise<{ success: boolean; message?: string }> {
    // 刷新功能需要重新验证 Cookie 有效性
    // 这个方法由 service 层调用，service 会先获取 bindingData
    // 然后调用 bind 方法重新验证
    logger.info('[CF Binder] Refresh requested', { userId })

    return {
      success: false,
      message: '请使用 bind 方法刷新绑定',
    }
  }
}

/**
 * 获取 Codeforces 平台配置 Schema（供前端使用）
 */
export function getCodeforcesConfigSchema(): import('../platform-binding.types').PlatformConfigSchema {
  return {
    fields: [
      {
        key: 'JSESSIONID',
        label: 'JSESSIONID',
        type: 'text',
        required: true,
        placeholder: '从 Cookie 中获取',
      },
    ],
    helpText: '请在浏览器登录 Codeforces 后，从开发者工具 (F12) → Application → Cookies → codeforces.com 中获取 JSESSIONID 的值',
  }
}