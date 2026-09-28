export type OjPlatformStatus = 'supported' | 'link-only' | 'deprecated'

export interface OjPlatformDefinition {
  key: string
  aliases: readonly string[]
  displayName: string
  fetch: {
    supported: boolean
    requiresCookie: boolean
  }
  archive: {
    supported: boolean
  }
  status: OjPlatformStatus
}

const platforms = [
  ['carits', 'Carits平台'], ['poj', 'POJ'], ['zoj', 'ZOJ'], ['uva', 'UVA'],
  ['livearchive', 'Live Archive'], ['sgu', 'SGU'], ['ural', 'URAL'], ['hust', 'HUST'],
  ['spoj', 'SPOJ'], ['hdu', 'HDU'], ['hysbz', 'HYSBZ'], ['codeforces', 'CodeForces'],
  ['gym', 'Gym'], ['z-trening', 'Z-Trening'], ['aizu', 'Aizu'], ['lightoj', 'LightOJ'],
  ['uestc', 'UESTC'], ['nbut', 'NBUT'], ['fzu', 'FZU'], ['csu', 'CSU'], ['scu', 'SCU'],
  ['acdream', 'ACdream'], ['codechef', 'CodeChef'], ['openj_bailian', 'OpenJudge 百炼'],
  ['openj_noi', 'OpenJudge NOI'], ['openj_poj', 'OpenJudge POJ'], ['kattis', 'Kattis'],
  ['hihocoder', 'HihoCoder'], ['hit', 'HIT'], ['hrbust', 'HRBUST'], ['eijudge', 'EIJudge'],
  ['atcoder', 'AtCoder'], ['hackerrank', 'HackerRank'], ['51nod', '51Nod'], ['topcoder', 'TopCoder'],
  ['eolymp', 'EOlymp'], ['jisuanke', '计蒜客'], ['libreoj', 'LibreOJ'], ['uoj', 'UOJ'],
  ['universaloj', 'UniversalOJ'], ['darkbzoj', 'DarkBZOJ'], ['csg', 'CSG'], ['csgdmoj', 'CSGDMOJ'],
  ['toph', 'Toph'], ['luogu', '洛谷'], ['baekjoon', 'Baekjoon'], ['qoj', 'QOJ'],
  ['cses', 'CSES'], ['usaco', 'USACO'], ['ojuz', 'oj.uz'], ['yosupo', 'Yosupo'],
  ['yukicoder', 'yukicoder'], ['vnoj', 'VNOJ'], ['tlx', 'TLX'], ['bzoj', 'BZOJ'],
  ['kilonova', 'Kilonova'], ['szkopul', 'Szkopuł'], ['csacademy', 'CSAcademy'],
  ['nowcoder', '牛客'], ['krsu', 'KRSU'], ['codefun', '代码源OJ'], ['dmoj', 'DMOJ'],
  ['vijos', 'Vijos'], ['other', '其他'],
] as const

export type OjPlatformKey = (typeof platforms)[number][0]

const fetchable = new Set<string>([
  'luogu', 'codeforces', 'atcoder', 'gym', 'qoj', 'hdu', 'poj', 'ural', 'usaco', 'tlx',
  'libreoj', 'yosupo', '51nod', 'csacademy', 'kattis', 'yukicoder', 'vnoj', 'kilonova',
  'ojuz', 'aizu', 'openj_bailian', 'openj_noi', 'openj_poj', 'uoj', 'universaloj', 'csg',
  'nowcoder', 'szkopul', 'darkbzoj', 'dmoj', 'cses', 'spoj', 'baekjoon', 'vijos', 'eolymp',
])

const aliases: Record<string, readonly string[]> = {
  ojuz: ['oj.uz'],
  uoj: ['universal-oj'],
  libreoj: ['loj'],
  csg: ['csgoj'],
}

export const OJ_PLATFORM_REGISTRY: readonly OjPlatformDefinition[] = platforms.map(([key, displayName]) => ({
  key,
  displayName,
  aliases: aliases[key] || [],
  fetch: { supported: fetchable.has(key), requiresCookie: key === 'luogu' },
  archive: { supported: key === 'codeforces' || key === 'luogu' },
  status: fetchable.has(key) ? 'supported' : 'link-only',
}))

/** Exact registered names only. Display labels are inputs, never storage keys. */
export function buildOjPlatformIdentifierIndex(
  definitions: readonly OjPlatformDefinition[],
): ReadonlyMap<string, OjPlatformDefinition> {
  const index = new Map<string, OjPlatformDefinition>()
  const keys = new Set<string>()
  for (const definition of definitions) {
    if (!/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/.test(definition.key) || keys.has(definition.key)) {
      throw new Error(`Invalid or duplicate OJ platform key: ${definition.key}`)
    }
    keys.add(definition.key)
    for (const name of [definition.key, definition.displayName, ...definition.aliases]) {
      const identifier = name.trim().toLowerCase()
      if (!identifier) throw new Error(`Empty OJ platform name: ${definition.key}`)
      const previous = index.get(identifier)
      if (previous && previous.key !== definition.key) {
        throw new Error(`Ambiguous OJ platform name: ${name}`)
      }
      index.set(identifier, definition)
    }
  }
  return index
}

const byIdentifier = buildOjPlatformIdentifierIndex(OJ_PLATFORM_REGISTRY)

export function getOjPlatform(identifier: string | null | undefined): OjPlatformDefinition | undefined {
  return typeof identifier === 'string' ? byIdentifier.get(identifier.trim().toLowerCase()) : undefined
}

/** Normalize a platform label/key, never a problem number or account name. */
export function normalizeOjPlatformKey(identifier: string): string | null {
  return getOjPlatform(identifier)?.key || null
}

export function getOjPlatformLabel(identifier: string): string {
  return getOjPlatform(identifier)?.displayName || identifier
}

export function getOjProblemUrl(identifier: string, rawProblemId: string): string | null {
  const platform = normalizeOjPlatformKey(identifier)
  const problemId = rawProblemId.trim()
  if (!platform || !problemId || platform === 'carits' || platform === 'other') return null
  const indexed = problemId.match(/^(\d+)([A-Za-z]\d*)$/)
  switch (platform) {
    case 'luogu': return `https://www.luogu.com.cn/problem/${problemId}`
    case 'codeforces': return indexed ? `https://codeforces.com/problemset/problem/${indexed[1]}/${indexed[2]}` : `https://codeforces.com/problemset/problem/${problemId}`
    case 'atcoder': { const split = problemId.lastIndexOf('_'); const contest = split >= 0 ? problemId.slice(0, split) : problemId; return `https://atcoder.jp/contests/${contest}/tasks/${problemId}?lang=en` }
    case 'gym': return indexed ? `https://codeforces.com/gym/${indexed[1]}/problem/${indexed[2]}` : `https://codeforces.com/gym/${problemId}`
    case 'qoj': return `https://qoj.ac/problem/${problemId}`
    case 'hdu': return `https://acm.hdu.edu.cn/showproblem.php?pid=${problemId}`
    case 'poj': return `http://poj.org/problem?id=${problemId}`
    case 'ural': return `https://acm.timus.ru/problem.aspx?space=1&num=${problemId}`
    case 'usaco': return `https://usaco.org/index.php?page=viewproblem2&cpid=${problemId}`
    case 'tlx': return `https://tlx.toki.id/problems/${problemId}`
    case 'libreoj': return `https://loj.ac/p/${problemId}`
    case 'yosupo': return `https://judge.yosupo.jp/problem/${problemId}`
    case '51nod': return `https://www.51nod.com/Challenge/Problem.html#problemId=${problemId}`
    case 'csacademy': return `https://csacademy.com/contest/archive/task/${problemId}/`
    case 'kattis': return `https://open.kattis.com/problems/${problemId}`
    case 'yukicoder': return `https://yukicoder.me/problems/no/${problemId}`
    case 'vnoj': return `https://oj.vnoi.info/problem/${problemId}`
    case 'kilonova': return `https://kilonova.ro/problems/${problemId}`
    case 'ojuz': return `https://oj.uz/problem/view/${problemId}`
    case 'aizu': return `https://onlinejudge.u-aizu.ac.jp/problems/${problemId}`
    case 'openj_bailian': return `http://bailian.openjudge.cn/practice/${problemId}/`
    case 'openj_noi': return `http://noi.openjudge.cn/problem/${problemId}/`
    case 'openj_poj': return `http://poj.openjudge.cn/practice/${problemId}/`
    case 'uoj': case 'universaloj': return `https://uoj.ac/problem/${problemId}`
    case 'csg': return `https://csgoj.com/problem/${problemId}`
    case 'nowcoder': return `https://ac.nowcoder.com/acm/problem/${problemId}`
    case 'szkopul': return `https://szkopul.edu.pl/problemset/problem/${problemId}/site/`
    case 'darkbzoj': return `https://darkbzoj.cc/problem/${problemId}`
    case 'dmoj': return `https://dmoj.ca/problem/${problemId}`
    case 'baekjoon': return `https://www.acmicpc.net/problem/${problemId}`
    case 'codechef': return `https://www.codechef.com/problems/${problemId}`
    case 'cses': return `https://cses.fi/problemset/task/${problemId}`
    case 'spoj': return `https://www.spoj.com/problems/${problemId}`
    case 'uva': return `https://onlinejudge.org/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=${problemId}`
    case 'vijos': return `https://vijos.org/p/${problemId}`
    case 'eolymp': return `https://www.eolymp.com/en/problems/${problemId}`
    case 'hackerrank': return `https://www.hackerrank.com/challenges/${problemId}/problem`
    case 'bzoj': return `https://www.lydsy.com/JudgeOnline/problem.php?id=${problemId}`
    case 'zoj': return `https://zoj.pintia.cn/problem-sets/918273645003/problems/${problemId}`
    case 'lightoj': return `https://lightoj.com/problem/${problemId}`
    case 'hihocoder': return `https://hihocoder.com/problemset/problem/${problemId}`
    case 'topcoder': return `https://community.topcoder.com/stat?c=problem_statement&pm=${problemId}`
    case 'jisuanke': return `https://www.jisuanke.com/problem/${problemId}`
    default: return null
  }
}
