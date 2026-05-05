/**
 * Platform Binders - Index
 * 平台绑定器注册和导出
 */

import type { PlatformBinder, BinderPlatformConfig } from './types'
import type { BindingPlatform } from '../platform-binding.types'
import { VJudgeBinder } from './vjudge'
import { LuoguBinder } from './luogu'
import { CodeforcesBinder } from './codeforces'
import { AtcoderBinder } from './atcoder'

// 导出类型
export * from './types'

// 导出各平台绑定器
export { VJudgeBinder } from './vjudge'
export { LuoguBinder } from './luogu'
export { CodeforcesBinder } from './codeforces'
export { AtcoderBinder } from './atcoder'

/**
 * 已注册的绑定器列表
 * 新增平台时，在此处注册绑定器实例
 */
const binders = new Map<BindingPlatform, PlatformBinder>()

// 注册绑定器
binders.set('vjudge', new VJudgeBinder())
binders.set('luogu', new LuoguBinder())
binders.set('codeforces', new CodeforcesBinder())
// binders.set('atcoder', new AtcoderBinder())

/**
 * 获取指定平台的绑定器
 * @param platform - 平台标识
 * @returns 绑定器实例，如果平台不支持则返回 undefined
 */
export function getBinder(platform: BindingPlatform): PlatformBinder | undefined {
  return binders.get(platform)
}

/**
 * 获取所有支持的平台列表
 * @returns 平台配置列表
 */
export function getSupportedPlatforms(): BinderPlatformConfig[] {
  return [
    {
      id: 'vjudge',
      name: 'Vjudge',
      color: '#4A90A4',
      supported: binders.has('vjudge')
    },
    {
      id: 'luogu',
      name: '洛谷',
      color: '#3498db',
      supported: binders.has('luogu')
    },
    {
      id: 'codeforces',
      name: 'Codeforces',
      color: '#1f8dd6',
      supported: binders.has('codeforces')
    },
    {
      id: 'atcoder',
      name: 'AtCoder',
      color: '#000',
      supported: binders.has('atcoder')
    }
  ]
}

/**
 * 检查平台是否支持绑定
 * @param platform - 平台标识
 * @returns 是否支持
 */
export function isPlatformSupported(platform: BindingPlatform): boolean {
  return binders.has(platform)
}