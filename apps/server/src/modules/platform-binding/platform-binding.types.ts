/**
 * Platform Binding Module - Type Definitions
 * 平台绑定模块类型定义
 */

import type { JwtPayload } from '@oi-manager/shared'
import type { AccountRole } from '@oi-manager/contracts'

// ==================== 基础类型 ====================

/** 支持的平台 */
export type BindingPlatform = 'vjudge' | 'luogu' | 'codeforces' | 'atcoder'

/** 绑定状态 */
export type BindingStatus = 'unbound' | 'pending' | 'bound' | 'failed' | 'expired'

// ==================== 数据库模型类型 ====================

/** 平台绑定记录 */
export interface PlatformBindingRecord {
  id: string
  userId: string
  platform: string  // Prisma returns string, not the union type
  platformUsername: string | null
  platformUid: string | null
  bindingStatus: string  // Prisma returns string, not the union type
  bindingData: string | null
  platformConfig: string | null
  statusMessage: string | null
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
  statusMessage?: string | null
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
  { id: 'luogu', name: '洛谷', color: '#3498db', supported: true },
  { id: 'codeforces', name: 'Codeforces', color: '#1f8dd6', supported: true },
  { id: 'atcoder', name: 'AtCoder', color: '#000', supported: false },
]

// ==================== DTO 类型 ====================

/** 发起绑定请求 */
export interface BindRequest {
  platformUsername: string
  password?: string
  extra?: Record<string, any>
}

/** 平台配置字段定义 */
export interface PlatformConfigField {
  key: string
  label: string
  type: 'text' | 'password' | 'textarea'
  required: boolean
  placeholder?: string
}

/** 平台配置 Schema */
export interface PlatformConfigSchema {
  fields: PlatformConfigField[]
  helpText: string
}

/** 绑定结果 */
export interface BindResult {
  success: boolean
  message?: string
  platformUsername?: string
  bindingData?: string  // 序列化的绑定数据（如 Cookie Jar）
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
  accountRole: AccountRole
  username: string
}
