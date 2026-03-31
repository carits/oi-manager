/**
 * VJudge 平台绑定器
 *
 * 职责：
 * 1. 提供配置 Schema（用户名 + 密码）
 * 2. 实现绑定流程（登录 + Cookie 保存）
 * 3. 实现解绑流程（清除本地数据）
 * 4. 实现刷新流程（验证会话有效性）
 */

import { PlatformBinder } from './types'
import { VJudgeSession, VJudgeSessionData } from './vjudge-session'
import type { PlatformConfigSchema, BindResult } from '../platform-binding.types'

/**
 * VJudge 绑定器
 */
export class VJudgeBinder implements PlatformBinder {
  platform = 'vjudge' as const

  /**
   * 验证用户名格式
   */
  async validateUsername(username: string): Promise<{ valid: boolean; message?: string }> {
    if (!username || username.length < 2) {
      return { valid: false, message: '请输入有效的用户名' }
    }
    if (username.length > 50) {
      return { valid: false, message: '用户名过长' }
    }
    return { valid: true }
  }

  /**
   * 绑定流程
   * 支持两种模式：
   * 1. Cookie 模式：用户从浏览器复制 Cookie 粘贴（推荐，绕过 Cloudflare）
   * 2. 密码模式：自动登录（可能被 Cloudflare 拦截）
   */
  async bind(params: {
    username: string
    password?: string
    extra?: Record<string, any>
  }): Promise<BindResult> {
    const { username, password, extra } = params
    const actualPassword = password || extra?.password
    const cookieString = extra?.cookieString || extra?.cookies

    // 优先使用 Cookie 模式（绕过 Cloudflare）
    if (cookieString) {
      console.log(`[VJudge] Cookie mode binding for: ${username}`)
      try {
        const session = new VJudgeSession()
        session.loadRawCookieString(cookieString)

        // 验证 Cookie 是否有效 - 访问首页检查登录状态
        const html = await session.get('https://vjudge.net/')

        // 检测登录状态：页面中包含用户名说明已登录
        // VJudge 登录后页面包含: <a ... id="userNameDropdown">carits</a>
        const hasLogout = html.includes('/user/logout')
        const hasUsername = html.includes(`>${username}<`)
        const hasDropdown = html.includes('userNameDropdown')
        const isLoggedIn = hasLogout || hasUsername || hasDropdown

        console.log(`[VJudge] Cookie validation: hasLogout=${hasLogout}, hasUsername(${username})=${hasUsername}, hasDropdown=${hasDropdown}`)
        console.log('[VJudge] HTML length:', html.length, ', preview:', html.substring(0, 300))

        if (isLoggedIn) {
          // 尝试从页面提取实际用户名
          let realUsername = username
          const dropdownMatch = html.match(/userNameDropdown[^>]*>([^<]+)</)
          if (dropdownMatch) {
            realUsername = dropdownMatch[1].trim()
            console.log(`[VJudge] Extracted username from page: ${realUsername}`)
          }

          const cookiesData = await session.saveCookies()
          const bindingData: VJudgeSessionData = {
            cookies: cookiesData,
            username: realUsername,
            password: actualPassword || '',
            verifiedAt: new Date().toISOString(),
          }

          console.log(`[VJudge] Cookie mode bind successful for: ${realUsername}`)
          return {
            success: true,
            message: '绑定成功',
            platformUsername: realUsername,
            bindingData: JSON.stringify(bindingData),
          }
        } else {
          console.log('[VJudge] Login indicators not found. HTML preview:', html.substring(0, 1000))
          return {
            success: false,
            message: 'Cookie 已失效，请重新从浏览器获取 Cookie',
          }
        }
      } catch (err) {
        console.error('[VJudge] Cookie mode bind error:', err)
        return {
          success: false,
          message: `Cookie 绑定失败: ${err instanceof Error ? err.message : '未知错误'}`,
        }
      }
    }

    // 密码模式（可能被 Cloudflare 拦截）
    if (!actualPassword) {
      return { success: false, message: '请输入密码或提供 Cookie' }
    }

    console.log(`[VJudge] Password mode binding for: ${username}`)

    const session = new VJudgeSession()
    const result = await session.login(username, actualPassword)

    if (result.success) {
      try {
        const cookiesData = await session.saveCookies()
        const bindingData: VJudgeSessionData = {
          cookies: cookiesData,
          username: result.username || username,
          password: actualPassword,
          verifiedAt: new Date().toISOString(),
        }

        console.log(`[VJudge] Bind successful for: ${result.username}`)
        return {
          success: true,
          message: '绑定成功',
          platformUsername: result.username,
          bindingData: JSON.stringify(bindingData),
        }
      } catch (err) {
        console.error('[VJudge] Failed to save cookies:', err)
        return {
          success: false,
          message: '保存会话失败，请重试',
        }
      }
    }

    // 检测 Cloudflare 人机验证拦截
    const msg = (result.message || '').toLowerCase()
    if (msg.includes('cloudflare') || msg.includes('human verification') || msg.includes('just a moment') || msg.includes('challenge-platform')) {
      return {
        success: false,
        message: '被 Cloudflare 人机验证拦截，请使用 Cookie 方式绑定：登录 vjudge.net → F12 开发者工具 → Network → 刷新页面 → 复制任意请求的 Cookie 值，粘贴到 Cookie 输入框中',
      }
    }

    console.log(`[VJudge] Bind failed: ${result.message}`)
    return {
      success: false,
      message: result.message || '绑定失败',
    }
  }

  /**
   * 解绑流程
   */
  async unbind(userId: string): Promise<{ success: boolean; message?: string }> {
    // VJudge 无需调用远程 API，只需清除本地记录
    console.log(`[VJudge] Unbind for user: ${userId}`)
    return { success: true, message: '已解除绑定' }
  }

  /**
   * 刷新流程 - 验证会话有效性
   */
  async refresh(userId: string): Promise<{ success: boolean; message?: string }> {
    // VJudge 刷新功能暂未完全实现
    // 需要从数据库获取 bindingData，这里先返回基础实现
    return {
      success: false,
      message: 'Vjudge 刷新功能暂未开放'
    }
  }
}

/**
 * 获取 VJudge 配置 Schema
 */
export function getVJudgeConfigSchema(): PlatformConfigSchema {
  return {
    fields: [
      {
        key: 'username',
        label: '用户名',
        type: 'text',
        required: true,
        placeholder: 'VJudge 用户名',
      },
      {
        key: 'password',
        label: '密码',
        type: 'password',
        required: false,
        placeholder: 'VJudge 密码（可选）',
      },
      {
        key: 'cookieString',
        label: 'Cookie（推荐）',
        type: 'textarea',
        required: false,
        placeholder: '从浏览器复制 Cookie 粘贴到此处（绕过 Cloudflare 验证）',
      },
    ],
    helpText: '推荐使用 Cookie 方式绑定：登录 vjudge.net → F12 打开开发者工具 -> Network -> 刷新页面 -> 复制任意请求的 Cookie 值。密码方式可能被 Cloudflare 人机验证拦截。',
  }
}
