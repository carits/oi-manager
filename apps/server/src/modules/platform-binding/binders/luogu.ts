/**
 * Luogu Platform Binder
 * 洛谷平台绑定器（预留实现）
 */

import type { PlatformBinder } from './types'

export class LuoguBinder implements PlatformBinder {
  platform = 'luogu' as const

  async validateUsername(username: string): Promise<{ valid: boolean; message?: string }> {
    // TODO: 实现洛谷用户名验证
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
    // TODO: 实现洛谷账号绑定
    // 参考: apps/server/src/oj-adapters/luogu.ts
    // 1. 验证用户名格式
    // 2. 通过洛谷 API 获取用户信息
    // 3. 如需要登录验证，使用 cookie 方式
    // 4. 保存绑定信息

    return {
      success: false,
      message: '洛谷绑定功能暂未开放，敬请期待'
    }
  }

  async unbind(userId: string): Promise<{ success: boolean; message?: string }> {
    // TODO: 实现洛谷解绑逻辑

    return { success: true }
  }

  async refresh(userId: string): Promise<{ success: boolean; message?: string }> {
    // TODO: 实现洛谷绑定刷新

    return {
      success: false,
      message: '洛谷刷新功能暂未开放'
    }
  }
}