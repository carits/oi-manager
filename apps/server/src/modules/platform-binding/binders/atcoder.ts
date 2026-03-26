/**
 * AtCoder Platform Binder
 * AtCoder 平台绑定器（预留实现）
 */

import type { PlatformBinder } from './types'

export class AtcoderBinder implements PlatformBinder {
  platform = 'atcoder' as const

  async validateUsername(username: string): Promise<{ valid: boolean; message?: string }> {
    // TODO: 实现 AtCoder 用户名验证
    if (!username || username.length < 1) {
      return { valid: false, message: '请输入 AtCoder 用户名' }
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
    // TODO: 实现 AtCoder 账号绑定
    // 1. 验证用户名格式
    // 2. 通过 AtCoder 网站获取用户信息
    // 3. 保存绑定信息

    return {
      success: false,
      message: 'AtCoder 绑定功能暂未开放，敬请期待'
    }
  }

  async unbind(userId: string): Promise<{ success: boolean; message?: string }> {
    // TODO: 实现 AtCoder 解绑逻辑

    return { success: true }
  }

  async refresh(userId: string): Promise<{ success: boolean; message?: string }> {
    // TODO: 实现 AtCoder 绑定刷新

    return {
      success: false,
      message: 'AtCoder 刷新功能暂未开放'
    }
  }
}