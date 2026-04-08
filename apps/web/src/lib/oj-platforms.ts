/**
 * OJ 平台共享常量
 * 所有前端页面共用一套平台列表，避免重复维护。
 * 后端白名单定义在 apps/server/src/oj-adapters/types.ts 的 KNOWN_OJ_PLATFORMS
 */

export interface OjPlatformOption {
  value: string
  label: string
}

/** 宲整 OJ 平台列表（含"全部"选项，用于筛选下拉） */
export const OJ_PLATFORMS: OjPlatformOption[] = [
  { value: '', label: '全部平台' },
  { value: 'carits', label: 'Carits（本平台）' },
  { value: 'poj', label: 'POJ' },
  { value: 'zoj', label: 'ZOJ' },
  { value: 'uva', label: 'UVA' },
  { value: 'livearchive', label: 'Live Archive' },
  { value: 'sgu', label: 'SGU' },
  { value: 'ural', label: 'URAL' },
  { value: 'hust', label: 'HUST' },
  { value: 'spoj', label: 'SPOJ' },
  { value: 'hdu', label: 'HDU' },
  { value: 'hysbz', label: 'HYSBZ' },
  { value: 'codeforces', label: 'CodeForces' },
  { value: 'gym', label: 'Gym' },
  { value: 'z-trening', label: 'Z-Trening' },
  { value: 'aizu', label: 'Aizu' },
  { value: 'lightoj', label: 'LightOJ' },
  { value: 'uestc', label: 'UESTC' },
  { value: 'nbut', label: 'NBUT' },
  { value: 'fzu', label: 'FZU' },
  { value: 'csu', label: 'CSU' },
  { value: 'scu', label: 'SCU' },
  { value: 'acdream', label: 'ACdream' },
  { value: 'codechef', label: 'CodeChef' },
  { value: 'openj_bailian', label: 'OpenJudge 百炼' },
  { value: 'openj_noi', label: 'OpenJudge NOI' },
  { value: 'openj_poj', label: 'OpenJudge POJ' },
  { value: 'kattis', label: 'Kattis' },
  { value: 'hihocoder', label: 'HihoCoder' },
  { value: 'hit', label: 'HIT' },
  { value: 'hrbust', label: 'HRBUST' },
  { value: 'eijudge', label: 'EIJudge' },
  { value: 'atcoder', label: 'AtCoder' },
  { value: 'hackerrank', label: 'HackerRank' },
  { value: '51nod', label: '51Nod' },
  { value: 'topcoder', label: 'TopCoder' },
  { value: 'eolymp', label: 'EOlymp' },
  { value: 'jisuanke', label: '计蒜客' },
  { value: 'libreoj', label: 'LibreOJ' },
  { value: 'universaloj', label: 'UniversalOJ' },
  { value: 'darkbzoj', label: '黑暗爆炸' },
  { value: 'csgdmoj', label: 'CSGDMOJ' },
  { value: 'toph', label: 'Toph' },
  { value: 'luogu', label: '洛谷' },
  { value: 'baekjoon', label: 'Baekjoon' },
  { value: 'qoj', label: 'QOJ' },
  { value: 'cses', label: 'CSES' },
  { value: 'usaco', label: 'USACO' },
  { value: 'oj.uz', label: 'oj.uz' },
  { value: 'yosupo', label: 'Yosupo' },
  { value: 'yukicoder', label: 'yukicoder' },
  { value: 'vnoj', label: 'VNOJ' },
  { value: 'tlx', label: 'TLX' },
  { value: 'bzoj', label: 'BZOJ' },
  { value: 'kilonova', label: 'Kilonova' },
  { value: 'szkopul', label: 'Szkopuł' },
  { value: 'csacademy', label: 'CSAcademy' },
  { value: 'nowcoder', label: '牛客' },
  { value: 'krsu', label: 'KRSU' },
  { value: 'codefun', label: '代码源OJ' },
  { value: 'other', label: '其他' },
]

/** 不含"全部平台"选项的纯平台列表 */
export const OJ_PLATFORMS_NO_ALL = OJ_PLATFORMS.filter(p => p.value !== '')

/** 平台 value → 显示名 映射 */
export const OJ_PLATFORM_LABEL_MAP: Record<string, string> = Object.fromEntries(
  OJ_PLATFORMS.map(p => [p.value, p.label]),
)

/** 有实际拉取 adapter 的平台（批量拉取仅限这些） */
export const FETCHABLE_PLATFORMS: OjPlatformOption[] = [
  { value: 'luogu', label: '洛谷' },
  { value: 'codeforces', label: 'CodeForces' },
  { value: 'atcoder', label: 'AtCoder' },
  { value: 'gym', label: 'Gym' },
  { value: 'qoj', label: 'QOJ' },
  { value: 'hdu', label: 'HDU' },
  { value: 'poj', label: 'POJ' },
  { value: 'ural', label: 'URAL' },
  { value: 'usaco', label: 'USACO' },
  { value: 'tlx', label: 'TLX' },
  { value: 'libreoj', label: 'LibreOJ' },
  { value: 'yosupo', label: 'Yosupo' },
  { value: '51nod', label: '51Nod' },
  { value: 'csacademy', label: 'CSAcademy' },
  { value: 'kattis', label: 'Kattis' },
  { value: 'yukicoder', label: 'yukicoder' },
  { value: 'vnoj', label: 'VNOJ' },
  { value: 'kilonova', label: 'Kilonova' },
  { value: 'ojuz', label: 'oj.uz' },
  { value: 'aizu', label: 'Aizu' },
  { value: 'openj_bailian', label: 'OpenJudge 百炼' },
  { value: 'openj_noi', label: 'OpenJudge NOI' },
  { value: 'openj_poj', label: 'OpenJudge POJ' },
  { value: 'uoj', label: 'UOJ' },
  { value: 'universaloj', label: 'UniversalOJ' },
  { value: 'csg', label: 'CSG' },
  { value: 'nowcoder', label: '牛客' },
  { value: 'szkopul', label: 'Szkopuł' },
  { value: 'darkbzoj', label: 'DarkBZOJ' },
  { value: 'dmoj', label: 'DMOJ' },
  { value: 'cses', label: 'CSES' },
  { value: 'spoj', label: 'SPOJ' },
  { value: 'baekjoon', label: 'Baekjoon' },
  { value: 'vijos', label: 'Vijos' },
  { value: 'eolymp', label: 'EOlymp' },
]

/**
 * 有自定义 Cookie 配置需求的平台及其字段定义。
 * 后续新增平台只需在此处添加条目，UI 自动适配。
 */
export const PLATFORM_COOKIE_FIELDS: Record<string, Array<{
  key: string
  label: string
  placeholder: string
}>> = {
  luogu: [
    { key: '__client_id', label: '__client_id', placeholder: '例如: 7d78f829...' },
    { key: '_uid', label: '_uid', placeholder: '例如: 401467' },
  ],
  // 后续其他平台可在此扩展，例如：
  // codeforces: [
  //   { key: 'cf_clearance', label: 'CF Clearance', placeholder: '...' },
  // ],
}

/** 判断平台是否有拉取 adapter */
export function isFetchablePlatform(platform: string): boolean {
  return FETCHABLE_PLATFORMS.some(p => p.value === platform)
}

/** 判断平台是否有 Cookie 配置 */
export function hasCookieConfig(platform: string): boolean {
  return !!PLATFORM_COOKIE_FIELDS[platform]
}

/** 评测记录用的 OJ 选项（含"本OJ" + "全部平台"） */
export const SUBMISSION_OJ_OPTIONS: OjPlatformOption[] = [
  { value: '', label: '全部平台' },
  { value: 'local', label: '本OJ' },
  ...OJ_PLATFORMS_NO_ALL,
]
