/**
 * OJ 远程题目拉取适配器
 * @description 统一管理和导出所有 OJ 平台适配器
 * P0 可观测性增强：添加调用计时和 metrics
 */

import { OjAdapter, OjPlatform, OjFetchError, OjErrorCode, OjProblem } from './types'
import { getOjPlatform, normalizeOjPlatformKey } from '@oi-manager/shared'
import logger from '../lib/logger'
import { metrics } from '../lib/metrics'
import { LuoguAdapter } from './luogu'
import { AtcoderAdapter } from './atcoder'
import { CodeforcesAdapter } from './codeforces'
import { GymAdapter } from './gym'
import { QojAdapter } from './qoj'
import { HduAdapter } from './hdu'
import { PojAdapter } from './poj'
import { UralAdapter } from './ural'
import { UsacoAdapter } from './usaco'
import { TlxAdapter } from './tlx'
import { LibreojAdapter } from './libreoj'
import { YosupoAdapter } from './yosupo'
import { Nod51Adapter } from './nod51'
import { CsacademyAdapter } from './csacademy'
import { KattisAdapter } from './kattis'
import { YukicoderAdapter } from './yukicoder'
import { VnojAdapter } from './vnoj'
import { KilonovaAdapter } from './kilonova'
import { OjuzAdapter } from './ojuz'
import { AizuAdapter } from './aizu'
import { OpenjBailianAdapter } from './openj_bailian'
import { OpenjNoiAdapter } from './openj_noi'
import { OpenjPojAdapter } from './openj_poj'
import { UojAdapter } from './uoj'
import { CsgAdapter } from './csg'
import { NowcoderAdapter } from './nowcoder'
import { SzkopulAdapter } from './szkopul'
import { DarkbzojAdapter } from './darkbzoj'
import { DmojAdapter } from './dmoj'
import { CsesAdapter } from './cses'
import { SpojAdapter } from './spoj'
import { BaekjoonAdapter } from './baekjoon'
import { VijosAdapter } from './vijos'
import { EolympAdapter } from './eolymp'

// 导出类型
export * from './types'

// 导出适配器
export { LuoguAdapter } from './luogu'
export { AtcoderAdapter } from './atcoder'
export { CodeforcesAdapter } from './codeforces'
export { GymAdapter } from './gym'
export { QojAdapter } from './qoj'
export { HduAdapter } from './hdu'
export { PojAdapter } from './poj'
export { UralAdapter } from './ural'
export { UsacoAdapter } from './usaco'
export { TlxAdapter } from './tlx'
export { LibreojAdapter } from './libreoj'
export { YosupoAdapter } from './yosupo'
export { Nod51Adapter } from './nod51'
export { CsacademyAdapter } from './csacademy'
export { KattisAdapter } from './kattis'
export { YukicoderAdapter } from './yukicoder'
export { VnojAdapter } from './vnoj'
export { KilonovaAdapter } from './kilonova'
export { OjuzAdapter } from './ojuz'
export { AizuAdapter } from './aizu'
export { OpenjBailianAdapter } from './openj_bailian'
export { OpenjNoiAdapter } from './openj_noi'
export { OpenjPojAdapter } from './openj_poj'
export { UojAdapter } from './uoj'
export { CsgAdapter } from './csg'
export { NowcoderAdapter } from './nowcoder'
export { SzkopulAdapter } from './szkopul'
export { DarkbzojAdapter } from './darkbzoj'
export { DmojAdapter } from './dmoj'
export { CsesAdapter } from './cses'
export { SpojAdapter } from './spoj'
export { BaekjoonAdapter } from './baekjoon'
export { VijosAdapter } from './vijos'
export { EolympAdapter } from './eolymp'

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
  ['poj', new PojAdapter() as OjAdapter],
  ['ural', new UralAdapter() as OjAdapter],
  ['usaco', new UsacoAdapter() as OjAdapter],
  ['tlx', new TlxAdapter() as OjAdapter],
  ['libreoj', new LibreojAdapter() as OjAdapter],
  ['yosupo', new YosupoAdapter() as OjAdapter],
  ['51nod', new Nod51Adapter() as OjAdapter],
  ['csacademy', new CsacademyAdapter() as OjAdapter],
  ['kattis', new KattisAdapter() as OjAdapter],
  ['yukicoder', new YukicoderAdapter() as OjAdapter],
  ['vnoj', new VnojAdapter() as OjAdapter],
  ['kilonova', new KilonovaAdapter() as OjAdapter],
  ['ojuz', new OjuzAdapter() as OjAdapter],
  ['aizu', new AizuAdapter() as OjAdapter],
  ['openj_bailian', new OpenjBailianAdapter() as OjAdapter],
  ['openj_noi', new OpenjNoiAdapter() as OjAdapter],
  ['openj_poj', new OpenjPojAdapter() as OjAdapter],
  ['uoj', new UojAdapter() as OjAdapter],
  ['universaloj', new UojAdapter() as OjAdapter],
  ['csg', new CsgAdapter() as OjAdapter],
  ['nowcoder', new NowcoderAdapter() as OjAdapter],
  ['szkopul', new SzkopulAdapter() as OjAdapter],
  ['darkbzoj', new DarkbzojAdapter() as OjAdapter],
  ['dmoj', new DmojAdapter() as OjAdapter],
  ['cses', new CsesAdapter() as OjAdapter],
  ['spoj', new SpojAdapter() as OjAdapter],
  ['baekjoon', new BaekjoonAdapter() as OjAdapter],
  ['vijos', new VijosAdapter() as OjAdapter],
  ['eolymp', new EolympAdapter() as OjAdapter],
])

/**
 * 获取指定平台的适配器
 * @param platform - OJ 平台标识
 * @returns 对应的适配器实例
 * @throws {OjFetchError} 当平台不支持时抛出
 */
export function getAdapter(platform: string): OjAdapter {
  const canonical = normalizeOjPlatformKey(platform) as OjPlatform | null
  const adapter = canonical ? adapters.get(canonical) : undefined
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
  const keys = [...adapters.keys(), 'uva', 'bzoj'] as OjPlatform[]
  return keys.map(platform => ({
    platform,
    name: getOjPlatform(platform)?.displayName || platform,
    supported: adapters.has(platform),
  }))
}

/**
 * 检查平台是否支持（有 adapter）
 * @param platform - OJ 平台标识
 * @returns 是否支持
 */
export function isPlatformSupported(platform: string): boolean {
  const canonical = normalizeOjPlatformKey(platform) as OjPlatform | null
  return Boolean(canonical && adapters.has(canonical))
}

/**
 * 检查平台是否为已知 OJ 平台（白名单验证）
 * @param platform - 平台标识字符串
 * @returns 是否为已知的 OJ 平台
 */
export function isKnownPlatform(platform: string): boolean {
  return Boolean(getOjPlatform(platform))
}

/**
 * 带计时的题目拉取函数
 * @description 包装 adapter.fetch，添加调用计时和 metrics 记录
 * P0 可观测性增强：外部调用监控
 */
export async function fetchProblemWithMetrics(
  platform: OjPlatform,
  problemId: string
): Promise<OjProblem> {
  const startTime = Date.now()
  const metricName = `oj_fetch:${platform}`

  logger.info('oj_fetch_start', {
    action: 'oj_adapter',
    metadata: { platform, problemId }
  })

  try {
    const adapter = getAdapter(platform)
    const result = await adapter.fetch(problemId)
    const duration = Date.now() - startTime

    metrics.recordExternalCall(metricName, duration, true)

    logger.info('oj_fetch_success', {
      action: 'oj_adapter',
      metadata: {
        platform,
        problemId,
        durationMs: duration,
        hasTitle: !!result.title,
        hasDescription: !!result.description
      }
    })

    return result
  } catch (error) {
    const duration = Date.now() - startTime
    metrics.recordExternalCall(metricName, duration, false)

    logger.error('oj_fetch_error', error, {
      action: 'oj_adapter',
      metadata: { platform, problemId, durationMs: duration }
    })

    throw error
  }
}
