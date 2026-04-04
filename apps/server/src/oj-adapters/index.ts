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
    { platform: 'gym', name: 'Gym', supported: true },
    { platform: 'qoj', name: 'QOJ', supported: true },
    { platform: 'hdu', name: 'HDU', supported: true },
    { platform: 'poj', name: 'POJ', supported: true },
    { platform: 'ural', name: 'URAL', supported: true },
    { platform: 'usaco', name: 'USACO', supported: true },
    { platform: 'tlx', name: 'TLX', supported: true },
    { platform: 'libreoj', name: 'LibreOJ', supported: true },
    { platform: 'yosupo', name: 'Yosupo', supported: true },
    { platform: '51nod', name: '51Nod', supported: true },
    { platform: 'csacademy', name: 'CSAcademy', supported: true },
    { platform: 'kattis', name: 'Kattis', supported: true },
    { platform: 'yukicoder', name: 'yukicoder', supported: true },
    { platform: 'vnoj', name: 'VNOJ', supported: true },
    { platform: 'kilonova', name: 'Kilonova', supported: true },
    { platform: 'ojuz', name: 'oj.uz', supported: true },
    { platform: 'aizu', name: 'Aizu', supported: true },
    { platform: 'openj_bailian', name: 'OpenJudge 百炼', supported: true },
    { platform: 'openj_noi', name: 'OpenJudge NOI', supported: true },
    { platform: 'openj_poj', name: 'OpenJudge POJ', supported: true },
    { platform: 'uoj', name: 'UOJ', supported: true },
    { platform: 'universaloj', name: 'UniversalOJ', supported: true },
    { platform: 'csg', name: 'CSG', supported: true },
    { platform: 'nowcoder', name: 'NowCoder', supported: true },
    { platform: 'szkopul', name: 'Szkopuł', supported: true },
    { platform: 'darkbzoj', name: 'DarkBZOJ', supported: true },
    { platform: 'dmoj', name: 'DMOJ', supported: true },
    { platform: 'cses', name: 'CSES', supported: true },
    { platform: 'baekjoon', name: 'Baekjoon', supported: true },
    { platform: 'spoj', name: 'SPOJ', supported: true },
    { platform: 'uva', name: 'UVa', supported: false },
    { platform: 'vijos', name: 'Vijos', supported: true },
    { platform: 'eolymp', name: 'EOlymp', supported: true },
    { platform: 'bzoj', name: 'BZOJ', supported: false },
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
