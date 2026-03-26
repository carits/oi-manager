/**
 * Platform Binding Module - Type Definitions
 * 平台绑定模块类型定义
 */

import type { UserRole, JwtPayload } from '../../../../packages/shared/src/index.js'

// ==================== 基础类型 ====================

/** 支持的平台 */
export type BindingPlatform = 'vjudge' | 'luogu' | 'codeforces' | 'atcoder'

/** 绑定状态 */
export type BindingStatus = 'unbound' | 'pending' | 'bound' | 'failed'

// ==================== 数据库模型类型 ====================

/** 平台绑定记录 */
export interface PlatformBindingRecord {
  id: string
  userId: string
  platform: BindingPlatform
  platformUsername: string | null
  bindingStatus: BindingStatus
  bindingData: string | null
  verifiedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** 平台绑定响应（返回给前端） */
export interface PlatformBindingResponse {
  id: string
  platform: BindingPlatform
  platformUsername: string | null
  bindingStatus: BindingStatus
  verifiedAt: Date | null
}

// ==================== 平台配置 ====================

/** 平台配置信息 */
export interface PlatformConfig {
  id: BindingPlatform
  name: string
  color: string
  description?: string
  supported: boolean
}

/** 所有支持的平台的配置 */
export const PLATFORM_CONFIGS: PlatformConfig[] = [
  { id: 'vjudge', name: 'Vjudge', color: '#4A90A4', supported: false },
  { id: 'luogu', name: '洛谷', color: '#3498db', supported: false },
  { id: 'codeforces', name: 'Codeforces', color: '#1f8dd6', supported: false },
  { id: 'atcoder', name: 'AtCoder', color: '#000', supported: false },
]

// ==================== DTO 类型 ====================

/** 发起绑定请求 */
export interface BindRequest {
  platformUsername: string
  password?: string
  extra?: Record<string, any>
}

/** 绑定结果 */
export interface BindResult {
  success: boolean
  message?: string
  platformUsername?: string
}

/** 解绑结果 */
export interface UnbindResult {
  success: boolean
  message?: string
}

// ==================== 用户身份 ====================

/** 用户身份信息（从 JWT 提取） */
export interface UserIdentity {
  userId: string
  role: UserRole
  username: string
}