/**
 * Platform Binder - Type Definitions
 * 平台绑定器类型定义
 */

import type { BindingPlatform } from '../platform-binding.types'

/**
 * 平台绑定器接口
 * 各平台需要实现此接口以提供绑定功能
 */
export interface PlatformBinder {
  /** 平台标识 */
  platform: BindingPlatform

  /**
   * 验证用户名是否有效
   * @param username - 平台用户名
   * @returns 验证结果
   */
  validateUsername(username: string): Promise<{ valid: boolean; message?: string }>

  /**
   * 执行绑定操作
   * @param params - 绑定参数
   * @returns 绑定结果
   */
  bind(params: {
    username: string
    password?: string
    extra?: Record<string, any>
  }): Promise<{
    success: boolean
    message?: string
    platformUsername?: string
    bindingData?: string
  }>

  /**
   * 解除绑定
   * @param userId - 用户 ID
   * @returns 解绑结果
   */
  unbind(userId: string): Promise<{ success: boolean; message?: string }>

  /**
   * 刷新绑定状态（如检查 token 是否有效）
   * @param userId - 用户 ID
   * @returns 刷新结果
   */
  refresh(userId: string): Promise<{ success: boolean; message?: string }>
}

/**
 * 平台配置信息
 */
export interface BinderPlatformConfig {
  id: BindingPlatform
  name: string
  color: string
  supported: boolean
}