/**
 * Vjudge Platform Binder
 * Vjudge 平台绑定器（预留实现）
 */

import type { PlatformBinder } from './types'

export class VjudgeBinder implements PlatformBinder {
  platform = 'vjudge' as const

  async validateUsername(username: string): Promise<{ valid: boolean; message?: string }> {
    // TODO: 实现 Vjudge 用户名验证
    if (!username || username.length < 2) {
      return { valid: false, message: '用户名长度至少 2 个字符' }
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
    // TODO: 实现 Vjudge 账号绑定
    // 1. 验证用户名格式
    // 2. 通过 API 或爬虫验证账号是否存在
    // 3. 如需要密码，验证登录
    // 4. 保存绑定信息

    return {
      success: false,
      message: 'Vjudge 绑定功能暂未开放，敬请期待'
    }
  }

  async unbind(userId: string): Promise<{ success: boolean; message?: string }> {
    // TODO: 实现 Vjudge 解绑逻辑
    // 1. 清除本地缓存的 token/cookie
    // 2. 调用 Vjudge 的登出 API（如果有）

    return { success: true }
  }

  async refresh(userId: string): Promise<{ success: boolean; message?: string }> {
    // TODO: 实现 Vjudge 绑定刷新
    // 1. 检查存储的 token/cookie 是否有效
    // 2. 如果过期，尝试刷新或提示用户重新绑定

    return {
      success: false,
      message: 'Vjudge 刷新功能暂未开放'
    }
  }
}