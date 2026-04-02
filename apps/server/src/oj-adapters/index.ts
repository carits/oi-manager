/**
 * OJ 远程题目拉取适配器
 * @description 统一管理和导出所有 OJ 平台适配器
 */

import { OjAdapter, OjPlatform, OjFetchError, OjErrorCode, KNOWN_OJ_PLATFORMS } from './types'
import { LuoguAdapter } from './luogu'
import { AtcoderAdapter } from './atcoder'
import { CodeforcesAdapter } from './codeforces'
import { GymAdapter } from './gym'
import { QojAdapter } from './qoj'
import { HduAdapter } from './hdu'

// 导出类型
export * from './types'

// 导出适配器
export { LuoguAdapter } from './luogu'
export { AtcoderAdapter } from './atcoder'
export { CodeforcesAdapter } from './codeforces'
export { GymAdapter } from './gym'
export { QojAdapter } from './qoj'
export { HduAdapter } from './hdu'

/**
 * 已注册的适配器列表
 * @description 新增 OJ 平台时，在此处注册适配器实例
 */
const adapters = new Map<OjPlatform, OjAdapter>([
  ['luogu', new LuoguAdapter() as OjAdapter],
  ['atcoder', new AtcoderAdapter() as OjAdapter],
  ['codeforces', new CodeforcesAdapter() as OjAdapter],
  ['gym', new GymAdapter() as OjAdapter],
  ['qoj', new QojAdapter() as OjAdapter],
  ['hdu', new HduAdapter() as OjAdapter],
])

/**
 * 获取指定平台的适配器
 * @param platform - OJ 平台标识
 * @returns 对应的适配器实例
 * @throws {OjFetchError} 当平台不支持时抛出
 */
export function getAdapter(platform: OjPlatform): OjAdapter {
  const adapter = adapters.get(platform)
  if (!adapter) {
    throw new OjFetchError(
      OjErrorCode.PLATFORM_NOT_SUPPORTED,
      `不支持的 OJ 平台: ${platform}`
    )
  }
  return adapter
}

/**
 * 获取所有支持的 OJ 平台列表
 * @returns 平台信息列表
 */
export function getSupportedPlatforms(): Array<{
  platform: OjPlatform
  name: string
  supported: boolean
}> {
  return [
    { platform: 'luogu', name: '洛谷', supported: true },
    { platform: 'codeforces', name: 'CodeForces', supported: true },
    { platform: 'atcoder', name: 'AtCoder', supported: true },
    { platform: 'loj', name: 'LOJ', supported: false },
    { platform: 'poj', name: 'POJ', supported: false },
    { platform: 'hdu', name: 'HDU', supported: true },
    { platform: 'spoj', name: 'SPOJ', supported: false },
    { platform: 'uva', name: 'UVa', supported: false },
    { platform: 'vijos', name: 'Vijos', supported: false },
    { platform: 'bzoj', name: 'BZOJ', supported: false },
    { platform: 'gym', name: 'Gym', supported: true },
    { platform: 'qoj', name: 'QOJ', supported: true },
  ]
}

/**
 * 检查平台是否支持（有 adapter）
 * @param platform - OJ 平台标识
 * @returns 是否支持
 */
export function isPlatformSupported(platform: OjPlatform): boolean {
  return adapters.has(platform)
}

/**
 * 检查平台是否为已知 OJ 平台（白名单验证）
 * @param platform - 平台标识字符串
 * @returns 是否为已知的 OJ 平台
 */
export function isKnownPlatform(platform: string): boolean {
  return KNOWN_OJ_PLATFORMS.some(p => p.value === platform)
}
