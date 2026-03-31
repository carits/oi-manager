/**
 * Luogu Platform Binder
 * 洛谷平台绑定器
 *
 * 使用 Cookie 方式绑定洛谷账号
 * 需要 __client_id 和 _uid 两个 Cookie
 */

import type { PlatformBinder } from './types'
import { fetchLuoguPage, parseCookieString, cookiesToString, type FetchResult } from './luogu-fetcher'
import { parseUserInfo, type LuoguUserInfo } from './luogu-parser'
import { saveDebugHtml, logDebugInfo, saveFetchResult } from './luogu-debug'

/**
 * 洛谷专属配置
 */
interface LuoguConfig {
  __client_id: string
  _uid: string
}

/**
 * 洛谷绑定数据（存储在 bindingData 中）
 */
interface LuoguBindingData {
  uid: string
  clientId: string    // __client_id Cookie
  uidCookie: string   // _uid Cookie
  verifiedAt: string
}

/**
 * 判断是否为有效的洛谷配置
 */
function isValidConfig(extra: Record<string, any> | undefined): extra is LuoguConfig {
  if (!extra) return false
  return typeof extra.__client_id === 'string' && typeof extra._uid === 'string'
}

/**
 * 洛谷平台绑定器
 */
export class LuoguBinder implements PlatformBinder {
  platform = 'luogu' as const

  async validateUsername(username: string): Promise<{ valid: boolean; message?: string }> {
    // 洛谷用户名验证：至少1个字符
    if (!username || username.length < 1) {
      return { valid: false, message: '请输入洛谷用户名' }
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
        message: '请提供有效的洛谷 Cookie：__client_id 和 _uid',
      }
    }

    const config = params.extra as LuoguConfig

    // 2. 构建 Cookie 字符串
    const cookieString = `__client_id=${config.__client_id}; _uid=${config._uid}`

    logDebugInfo({
      type: 'bind_start',
      preview: `Cookie 长度: ${cookieString.length}`,
    })

    try {
      // 3. 请求洛谷首页（处理 C3VK 挑战页）
      const result = await fetchLuoguPage(cookieString, 5, (info) => {
        logDebugInfo(info)
      })

      // 4. 请求失败
      if (!result.success) {
        // 保存调试信息
        if (result.html) {
          saveDebugHtml(result.html, 'bind_failed')
        }

        return {
          success: false,
          message: result.error || '请求洛谷失败',
        }
      }

      // 5. 解析用户信息
      const userInfo = parseUserInfo(result.html)

      // 6. 保存调试信息（用于分析）
      saveFetchResult(result, 'bind')

      // 7. 处理解析结果
      if (!userInfo.logged_in) {
        return {
          success: false,
          message: userInfo.reason || 'Cookie 已失效或未登录',
        }
      }

      // 8. 绑定成功（存储 Cookie 供导入服务使用）
      const bindingData: LuoguBindingData = {
        uid: userInfo.uid!,
        clientId: config.__client_id,
        uidCookie: config._uid,
        verifiedAt: new Date().toISOString(),
      }

      return {
        success: true,
        message: '绑定成功',
        platformUsername: userInfo.username,
        bindingData: JSON.stringify(bindingData),
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logDebugInfo({
        type: 'bind_error',
        preview: errorMessage,
      })

      return {
        success: false,
        message: `绑定失败: ${errorMessage}`,
      }
    }
  }

  async unbind(userId: string): Promise<{ success: boolean; message?: string }> {
    // 洛谷解绑只需要清除本地记录，无需调用远程 API
    return { success: true }
  }

  async refresh(userId: string): Promise<{ success: boolean; message?: string }> {
    // 刷新功能需要重新验证 Cookie 有效性
    // 这个方法由 service 层调用，service 会先获取 bindingData
    // 然后调用 bind 方法重新验证
    return {
      success: false,
      message: '请使用 bind 方法刷新绑定',
    }
  }
}

/**
 * 获取洛谷平台配置 Schema（供前端使用）
 */
export function getLuoguConfigSchema(): import('../platform-binding.types').PlatformConfigSchema {
  return {
    fields: [
      {
        key: '__client_id',
        label: '__client_id',
        type: 'text',
        required: true,
        placeholder: '从 Cookie 中获取',
      },
      {
        key: '_uid',
        label: '_uid',
        type: 'text',
        required: true,
        placeholder: '从 Cookie 中获取',
      },
    ],
    helpText: '请在浏览器登录洛谷后，从开发者工具 (F12) → Application → Cookies 中获取 __client_id 和 _uid 的值',
  }
}