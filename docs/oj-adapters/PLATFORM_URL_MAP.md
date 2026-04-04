# OJ 平台 URL 映射表

> 最后更新: 2026-04-03

前后端统一的平台标识 → URL 映射表。用于：
- 后端适配器 `getProblemUrl(pid)` 实现
- 前端 `getOjProblemUrl(platform, pid)` 原题链接
- 前端 `oj-platforms.ts` 平台列表

---

## 使用规则

1. **后端优先**: 后端 `ojBindings[].url` 存储了拉取时的原始 URL，前端应优先使用
2. **前端兜底**: `getOjProblemUrl()` 仅在后端未存储 URL 时使用
3. **新增平台**: 新增适配器时必须同时更新此表和前端映射

---

## 已有适配器 URL 映射（24 个）

| 平台标识 | 显示名称 | getProblemUrl(pid) | 题号格式 |
|----------|----------|-------------------|----------|
| `luogu` | 洛谷 | `https://www.luogu.com.cn/problem/{pid}` | `P\d+` \| `B\d+` \| `AT\d+` |
| `codeforces` | Codeforces | `https://codeforces.com/problemset/problem/{contestId}/{index}` | `\d+[A-Z]\d*` |
| `atcoder` | AtCoder | `https://atcoder.jp/contests/{contestId}/tasks/{pid}` | `abc\d+_[a-z]` 等 |
| `gym` | CF Gym | `https://codeforces.com/gym/{contestId}/problem/{index}` | `\d+[A-Z]\d*` |
| `qoj` | QOJ | `https://qoj.ac/problem/{pid}` | `\d+` |
| `hdu` | HDU | `https://acm.hdu.edu.cn/showproblem.php?pid={pid}` | `\d+` |
| `poj` | POJ | `http://poj.org/problem?id={pid}` | `\d+` |
| `ural` | URAL | `https://acm.timus.ru/problem.aspx?space=1&num={pid}` | `\d+` |
| `usaco` | USACO | `https://usaco.org/index.php?page=viewproblem2&cpid={pid}` | `\d+` |
| `tlx` | TLX | `https://tlx.toki.id/problems/{pid}` | slug |
| `libreoj` | LibreOJ | `https://loj.ac/problem/{pid}` | `\d+` |
| `yosupo` | Yosupo | `https://judge.yosupo.jp/problem/{pid}` | slug |
| `51nod` | 51Nod | `https://www.51nod.com/Challenge/Problem.html#problemId={pid}` | `\d+` |
| `csacademy` | CSAcademy | `https://csacademy.com/contest/archive/task/{pid}/` | slug |
| `kattis` | Kattis | `https://open.kattis.com/problems/{pid}` | `[a-z][a-z0-9_-]*` |
| `yukicoder` | yukicoder | `https://yukicoder.me/problems/no/{pid}` | `\d+` |
| `vnoj` | VNOJ | `https://oj.vnoi.info/problem/{pid}` | `[a-zA-Z0-9_-]+` |
| `kilonova` | Kilonova | `https://kilonova.ro/problems/{pid}` | `\d+` |
| `ojuz` | oj.uz | `https://oj.uz/problem/view/{pid}` | `[a-zA-Z0-9_]+` |
| `aizu` | Aizu | `https://onlinejudge.u-aizu.ac.jp/problems/{pid}` | `[A-Za-z0-9_]+` |
| `openjudge` | OpenJudge | `http://bailian.openjudge.cn/practice/{pid}/` | `\d+` |
| `uoj` | UOJ | `https://uoj.ac/problem/{pid}` | `\d+` |
| `csg` | CSG | `https://csgoj.com/problem/{pid}` | `\d+` |
| `nowcoder` | 牛客 | `https://ac.nowcoder.com/acm/problem/{pid}` | `\d+` |

---

## 待实现适配器 URL 映射

| 平台标识 | 显示名称 | getProblemUrl(pid) | 题号格式 |
|----------|----------|-------------------|----------|
| `szkopul` | Szkopuł | `https://szkopul.edu.pl/problemset/problem/{pid}/site/` | slug |
| `darkbzoj` | 黑暗爆炸 | `https://darkbzoj.cc/problem/{pid}` | `\d+` |
| `dmoj` | DMOJ | `https://dmoj.ca/problem/{pid}` | slug |
| `baekjoon` | Baekjoon | `https://www.acmicpc.net/problem/{pid}` | `\d+` |
| `codechef` | CodeChef | `https://www.codechef.com/problems/{pid}` | 字母数字 |
| `cses` | CSES | `https://cses.fi/problemset/task/{pid}` | `\d+` |
| `spoj` | SPOJ | `https://www.spoj.com/problems/{pid}` | 字母数字 |
| `uva` | UVa | `https://onlinejudge.org/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem={pid}` | `\d+` |
| `vijos` | Vijos | `https://vijos.org/p/{pid}` | `P\d+` |
| `eolymp` | EOlymp | `https://www.eolymp.com/en/problems/{pid}` | `\d+` |
| `hackerrank` | HackerRank | `https://www.hackerrank.com/challenges/{pid}/problem` | slug |

---

## 仅记录题号的平台（不支持拉取）

以下平台仅在前端显示题号和原题链接，不支持自动拉取题面：

| 平台标识 | 显示名称 | getProblemUrl(pid) |
|----------|----------|-------------------|
| `bzoj` | BZOJ | `https://www.lydsy.com/JudgeOnline/problem.php?id={pid}` |
| `loj` | LOJ | → 同 `libreoj`，`https://loj.ac/problem/{pid}` |
| `openj_bailian` | OpenJudge 百炼 | `http://bailian.openjudge.cn/practice/{pid}/` |
| `openj_noi` | OpenJudge NOI | `http://noi.openjudge.cn/{section}/{pid}/` |
| `openj_poj` | OpenJudge POJ | `http://poj.openjudge.cn/practice/{pid}/` |
| `zoj` | ZOJ | 需调研 |
| `lightoj` | LightOJ | 需调研 |
| `hihocoder` | HihoCoder | 需调研 |
| `topcoder` | TopCoder | 需调研 |
| `jisuanke` | 计蒜客 | 需调研 |

---

## 前端 `getOjProblemUrl()` 完整实现

```typescript
const getOjProblemUrl = (platform: string, problemId: string): string => {
  switch (platform) {
    // 已有适配器
    case 'luogu': return `https://www.luogu.com.cn/problem/${problemId}`
    case 'codeforces': {
      const m = problemId.match(/^(\d+)([A-Za-z]\d*)$/)
      return m
        ? `https://codeforces.com/problemset/problem/${m[1]}/${m[2]}`
        : `https://codeforces.com/problemset/problem/${problemId}`
    }
    case 'atcoder': {
      const last = problemId.lastIndexOf('_')
      const cid = last >= 0 ? problemId.substring(0, last) : problemId
      return `https://atcoder.jp/contests/${cid}/tasks/${problemId}`
    }
    case 'gym': {
      const m = problemId.match(/^(\d+)([A-Za-z]\d*)$/)
      return m
        ? `https://codeforces.com/gym/${m[1]}/problem/${m[2]}`
        : `https://codeforces.com/gym/${problemId}`
    }
    case 'qoj': return `https://qoj.ac/problem/${problemId}`
    case 'hdu': return `https://acm.hdu.edu.cn/showproblem.php?pid=${problemId}`
    case 'poj': return `http://poj.org/problem?id=${problemId}`
    case 'ural': return `https://acm.timus.ru/problem.aspx?space=1&num=${problemId}`
    case 'usaco': return `https://usaco.org/index.php?page=viewproblem2&cpid=${problemId}`
    case 'tlx': return `https://tlx.toki.id/problems/${problemId}`
    case 'libreoj': case 'loj': return `https://loj.ac/problem/${problemId}`
    case 'yosupo': return `https://judge.yosupo.jp/problem/${problemId}`
    case '51nod': return `https://www.51nod.com/Challenge/Problem.html#problemId=${problemId}`
    case 'csacademy': return `https://csacademy.com/contest/archive/task/${problemId}/`
    case 'kattis': return `https://open.kattis.com/problems/${problemId}`
    case 'yukicoder': return `https://yukicoder.me/problems/no/${problemId}`
    case 'vnoj': return `https://oj.vnoi.info/problem/${problemId}`
    case 'kilonova': return `https://kilonova.ro/problems/${problemId}`
    case 'ojuz': return `https://oj.uz/problem/view/${problemId}`
    case 'aizu': return `https://onlinejudge.u-aizu.ac.jp/problems/${problemId}`
    case 'openjudge': case 'openj_bailian': return `http://bailian.openjudge.cn/practice/${problemId}/`
    case 'openj_noi': return `http://noi.openjudge.cn/problem/${problemId}/`
    case 'openj_poj': return `http://poj.openjudge.cn/practice/${problemId}/`
    case 'uoj': return `https://uoj.ac/problem/${problemId}`
    case 'csg': return `https://csgoj.com/problem/${problemId}`
    case 'nowcoder': return `https://ac.nowcoder.com/acm/problem/${problemId}`

    // 待实现适配器
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
    case 'bzoj': return `https://www.lydsy.com/JudgeOnline/problem.php?id=${problemId}`

    default: return '#'
  }
}
```

---

## 后端 `getProblemUrl()` 映射同步

每个适配器文件中的 `getProblemUrl()` 实现必须与此表一致。新增适配器时需同步更新：

1. `apps/server/src/oj-adapters/{platform}.ts` — 适配器实现
2. `apps/server/src/oj-adapters/index.ts` — 注册
3. `apps/server/src/oj-adapters/types.ts` — `OjPlatform` 类型 + `KNOWN_OJ_PLATFORMS`
4. `apps/web/src/lib/oj-platforms.ts` — 前端平台列表
5. `apps/web/src/components/problem/ProblemDetail.tsx` — 前端 URL 映射
6. 本文档
