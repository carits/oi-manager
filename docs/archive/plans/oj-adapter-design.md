---
status: archived
audience: historical
last_verified: 2026-07-30
source_of_truth: historical snapshot
replacement: docs/architecture/modules/PROBLEMS_AND_OJ.md
---

> 历史文档：本文件保留当时的设计、调查或实现记录，不代表当前系统行为。请以 `docs/architecture/modules/PROBLEMS_AND_OJ.md` 为准。

# OJ 适配器设计文档

> 最后更新: 2026-04-03
> 状态: 设计阶段 — 待用户确认后实施

本文档覆盖所有 OJ 平台适配器的完整设计。每个平台包含：标识、URL 模板、题号格式、页面类型、解析策略、图片域名、PDF 处理、已知难点、测试题号。

---

## 目录

- [总览](#总览)
- [适配器架构](#适配器架构)
- [已有适配器（24 个）](#已有适配器)
- [待实现适配器](#待实现适配器)
- [不可实现平台](#不可实现平台)
- [前端 URL 映射](#前端-url-映射)
- [图片下载管线](#图片下载管线)

---

## 总览

### 平台分类

| 类别 | 数量 | 说明 |
|------|------|------|
| 已有适配器 | 24 | 已实现 `OjAdapter` 接口 |
| 待实现（可实现） | ~15 | 有明确解析路径 |
| 待调研 | ~10 | 需进一步确认可行性 |
| 不可实现 | ~10 | 需要 JS 渲染 + Cloudflare/登录墙 |

### 页面获取方式

| 方式 | 适配器 | 说明 |
|------|--------|------|
| **纯 HTTP + Cheerio** | luogu, codeforces, atcoder, gym, hdu, poj, ural, usaco, kattis, yukicoder, vnoj, kilonova, ojuz, aizu, openjudge, uoj, csg, nowcoder | fetch + cheerio 解析 HTML |
| **Playwright SPA** | qoj, tlx, libreoj, yosupo, 51nod, csacademy | 需要 JS 渲染 |
| **API** | luogu(部分), vnoj(API) | JSON 接口直接获取 |

---

## 适配器架构

### 接口定义

```typescript
interface OjAdapter {
  name: string                    // 平台显示名称
  platform: OjPlatform           // 平台标识符
  fetch(problemId: string): Promise<OjProblem>
  isValidProblemId(id: string): boolean
  getProblemUrl(id: string): string
  rateLimitConfig?: { ... }
}
```

### 通用工具

| 文件 | 说明 |
|------|------|
| `html-utils.ts` | `convertHtmlToMarkdown()`, `unescapeHtml()`, `stripTags()`, `resolveRelativeUrls()` |
| `types.ts` | `OjPlatform` 联合类型, `KNOWN_OJ_PLATFORMS` 列表 |
| `index.ts` | 适配器注册 Map, `getAdapter()`, `isPlatformSupported()` |

### 图片处理管线

```
适配器 fetch() 返回 Markdown
  → oj-fetcher.ts extractImageLinks() 提取图片 URL
  → downloadAndUploadImage() 下载并上传到 FileService
  → processMarkdownImages() 替换 Markdown 中的 URL
```

**当前问题**: `extractImageLinks()` 白名单只覆盖 luogu/atcoder/codeforces，其他平台图片不会被下载。

---

## 已有适配器

### 1. 洛谷 (Luogu)

- **标识**: `luogu`
- **主页**: https://www.luogu.com.cn
- **题面 URL**: `https://www.luogu.com.cn/problem/{pid}`
- **题号格式**: `P\d+` | `B\d+` | `AT\d+` | `CF\d+[A-Z]` | `UVA\d+` | `SP\d+` 等
- **页面类型**: HTTP（解析页面内嵌 JSON `lentille-context`）
- **HTML 结构**: 页面内嵌 `<script id="lentille-context">` JSON，含完整题目数据
- **图片域名**: `cdn.luogu.com.cn`, `s1.ax1x.com`, `img.zfig.cn`, `tex.luogu.com.cn`
- **PDF 处理**: 无 PDF 题面，全部 Markdown
- **附件**: 支持（`attachments[].downloadLink`），需 `LUOGU_COOKIE`
- **已知难点**:
  - 部分附件需登录 Cookie
  - 图片 Referer 限制，需设置 `Referer: https://www.luogu.com.cn/`
  - 多语言题面（`content` + `contentEn`）
- **限流**: 2 req/s, jitter 0.1-0.35s, max 3 retries
- **测试题号**: P1000, P1841, P1983, P3377, P2002, P3811, B2029, AT_abc301_e
- **测试题号说明**:
  - `P1000` — 简单 A+B（基础验证）
  - `P2002` — 题面含图片（消息扩散，图论题）
  - `P3811` — 题面含 LaTeX 公式（乘法逆元）
  - `P3377` — 题面较长且复杂（左偏树/可并堆）
  - `P1841` — 含附件/数据（Dinic 最大流）
  - `B2029` — 月赛题，验证 B 系列题号
  - `AT_abc301_e` — 联合题号验证

---

### 2. Codeforces

- **标识**: `codeforces`
- **主页**: https://codeforces.com
- **题面 URL**: `https://codeforces.com/problemset/problem/{contestId}/{letter}`
- **题号格式**: `\d+[A-Za-z]\d*`（如 `2A`, `1450E`, `1840C`）
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 题目: `.problem-statement` 内
  - 标题: `.title`
  - 时限/内存: `.time-limit`, `.memory-limit`
  - 题面: `.header + .input-file + .output-file` 之后各 `<div>` 节
  - 样例: `.sample-test > .input > pre`, `.sample-test > .output > pre`
- **图片域名**: `pic.codeforces.com`, `espresso.codeforces.com`
- **PDF 处理**: 无
- **已知难点**:
  - 主站偶尔 Cloudflare，有镜像站兜底
  - 图片 Referer 需 `https://codeforces.com/`
  - 兜底策略: CF 主站失败 → mirror → 洛谷 `CF{pid}`
- **限流**: 1 req/s, jitter 0.5-1.5s, max 3 retries
- **测试题号**: 2A, 474B, 1450E, 1840C, 1730E, 1512C
- **测试题号说明**:
  - `2A` — 简单基础验证
  - `1450E` — 题面含图片（Corrupted Array）
  - `1730E` — 题面较长复杂（Maximums and Minimums）
  - `1512C` — 需要解析表格/OJ 原生图片（A-B Palindrome）
  - `1840C` — 验证样例解析（Skateboard）

---

### 3. AtCoder

- **标识**: `atcoder`
- **主页**: https://atcoder.jp
- **题面 URL**: `https://atcoder.jp/contests/{contestId}/tasks/{pid}`
- **题号格式**: `[a-z]{2,}\d*_[a-z]\d*`（如 `abc100_a`, `arc216_a`）
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 容器: `#task-statement`
  - 语言切换: `span.lang-en` / `span.lang-ja`
  - 各节: `<h3>` 标题 + 后续 `<p>/<var>/<pre>` 内容
  - 样例: `<pre>` 内（含 `var` 数学符号）
- **图片域名**: `img.atcoder.jp`, `atcoder.jp`
- **PDF 处理**: 无
- **已知难点**:
  - 数学公式用 `<var>` 标签，需转为 `$...$`
  - 日英双语需切换 `?lang=en`
  - 兜底: 洛谷 `AT_{pid}`
- **限流**: 1 req/s, jitter 0.3-1.0s, max 3 retries
- **测试题号**: abc301_e, arc166_c, agc058_a, abc312_g, arc170_d, abc345_f, arc183_c
- **测试题号说明**:
  - `abc301_e` — 题面含图片（Travel by Car）
  - `abc312_g` — 题面较长（Avoid Straight Line）
  - `arc170_d` — 复杂图论/构造（Hanzi Buyer）
  - `abc345_f` — 含复杂 LaTeX（Insert String）

---

### 4. CF Gym

- **标识**: `gym`
- **主页**: https://codeforces.com
- **题面 URL**: `https://codeforces.com/gym/{contestId}/problem/{letter}`
- **题号格式**: `\d+[A-Za-z]\d*`（同 CF）
- **页面类型**: HTTP + Cheerio（继承 CodeforcesAdapter）
- **HTML 结构**: 同 Codeforces
- **图片域名**: 同 Codeforces
- **PDF 处理**: 无
- **已知难点**:
  - 部分比赛需登录
  - 继承 CF 的所有问题
- **测试题号**:
  - 102034A, 100001A, 101243A, 102542A, 103051A
- **测试题号说明**:
  - `100001A` — 基础题
  - `102034A` — 题面含图片（BAPC 2014qualifying）
  - `102542A` — 题面较长（ contest/ problem）
  - `103051A` — 多样化验证, 105039A
- **测试题号说明**:
  - `100001A` — 基础验证
  - `102034A` — 题面含图片
  - `105039A` — 题面较长

---

### 5. QOJ

- **标识**: `qoj`
- **主页**: https://qoj.ac
- **题面 URL**: `https://qoj.ac/problem/{pid}`
- **题号格式**: `\d+`
- **页面类型**: **Playwright (headed)** + Stealth
- **HTML 结构**:
  - 标题: `h1.page-header`
  - 时限/内存: `span.badge`
  - 题面: `article.uoj-article`
  - MathJax: `<script type="math/tex">` 含 LaTeX 源码
  - PDF: `iframe` 嵌入 `download.php?type=statement&id={pid}`
- **图片域名**: `qoj.ac`
- **PDF 处理**: ✅ 通过 `download.php?type=statement&id={pid}` 直接下载，经 FileService 上传
- **已知难点**:
  - **必须 headed 模式**（headless 无法过 Cloudflare）
  - 需 `QOJ_SESSION` 环境变量（UOJSESSID cookie）
  - CF challenge 约 3 秒自动通过
  - PDF 和 HTML 两种题面格式需分别处理
- **限流**: 无（Playwright 模式自带间隔）
- **测试题号**: 35, 76, 5340, 1538, 3165, 5803
- **测试题号说明**:
  - `35` — HTML 题面，含 LaTeX（Chinese Elephant Chess）
  - `76` — **PDF 题面**（经由 `download.php` 下载验证）
  - `1538` — PDF 题面 + Cloudflare 检测
  - `3165` — 题面较长
  - `5340` — 题面含图片
  - `5803` — 复杂题面

---

### 6. HDU

- **标识**: `hdu`
- **主页**: https://acm.hdu.edu.cn
- **题面 URL**: `https://acm.hdu.edu.cn/showproblem.php?pid={pid}`
- **题号格式**: `\d+`
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 容器: 表格布局 `table` + `td.problemtitle` 等
  - 标题: `h1` (无 class)
  - 各节: 通过内文关键词定位（"Problem Description", "Input", "Output" 等）
  - 样例: 跟在 `pre` 标签后
- **图片域名**: `acm.hdu.edu.cn`
- **PDF 处理**: 无
- **已知难点**:
  - 页面无语义 class，需按文本内容定位
  - 中文编码偶尔异常
  - 部分题目有图片（`<img src="data/images/xxx">`）
- **测试题号**: 1000, 1163, 2196, 4070, 5429, 6215
- **测试题号说明**:
  - `1000` — 基础题（A+B）
  - `1163` — 题面含图片（Eddy's digital Hats）
  - `2196` — 题面含图片，需相对路径解析（A + B）
  - `4070` — 题面较长
  - `5429` — 复杂题面（Geodetic Set Problem）

---

### 7. POJ

- **标识**: `poj`
- **主页**: http://poj.org
- **题面 URL**: `http://poj.org/problem?id={pid}`
- **题号格式**: `\d+`
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 容器: `div.ptx`
  - 标题: `div.ptitle`
  - 时限/内存: `div.plmt` / `div.pmlt`
  - 各节: `div.ptx` 内按 `p` + `pre` 组织
  - 样例: `pre.sio` (sample input/output)
- **图片域名**: `poj.org`
- **PDF 处理**: 无
- **已知难点**:
  - HTTP（非 HTTPS）
  - 页面较老，无明确语义标签
- **测试题号**: 1000, 1250, 2109, 3278, 4012, 5027
- **测试题号说明**:
  - `1000` — 基础验证
  - `3278` — 题面含图片（Matrix Multiplication）
  - `5027` — 题面含图论 + 复杂结构

---

### 8. URAL

- **标识**: `ural`
- **主页**: https://acm.timus.ru
- **题面 URL**: `https://acm.timus.ru/problem.aspx?space=1&num={pid}`
- **题号格式**: `\d+`
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 容器: `.problem_content`
  - 标题: `h2.title`
  - 时限/内存: `.problem_limits`
  - 各节: 通过 `h3` 标题分隔（Problem, Input, Output, Sample 等）
  - 样例: `table.sample` 内
- **图片域名**: `acm.timus.ru`
- **PDF 处理**: 无
- **已知难点**: 无特殊难点
- **测试题号**: 1000, 1197, 1517, 2029, 2449, 3521
- **测试题号说明**:
  - `1000` — 基础题
  - `2029` — 题面含图片（Trees）
  - `2449` — 复杂题面（Binary Polynomials）

---

### 9. USACO

- **标识**: `usaco`
- **主页**: https://usaco.org
- **题面 URL**: `https://usaco.org/index.php?page=viewproblem2&cpid={pid}`
- **题号格式**: `\d+`（cpid，非 USACO 原始编号）
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 容器: `span#probtext-text.mathjax`
  - 内含 HTML + MathJax
  - 样例: `<pre>` 标签内
- **图片域名**: `usaco.org`
- **PDF 处理**: 无
- **已知难点**:
  - **`&gt;` 等实体未正确解码** — 需在 `convertHtmlToMarkdown` 后二次检查
  - 相对 URL 需 `resolveRelativeUrls()` 处理
  - MathJax 用 `$...$` 语法
- **测试题号**: 1, 103, 766, 917, 1356, 2407
- **测试题号说明**:
  - `1` — Bronze 基础
  - `766` — Platinum 级别复杂题面
  - `917` — 题面含不等式 `&gt;` HTML 实体
  - `1356` — 题面含 LaTeX 数学公式

---

### 10. TLX (TOKI Learning Center)

- **标识**: `tlx`
- **主页**: https://tlx.toki.id
- **题面 URL**: `https://tlx.toki.id/problems/{pid}`
- **题号格式**: slug（如 `aplusb`, `tro-15-pengurangan`）
- **页面类型**: **Playwright SPA**
- **HTML 结构**:
  - React 渲染，需 `waitUntil: 'networkidle'`
  - 题面在 `.problem-statement` 内
  - 各节用 `<h3>` 标题
- **图片域名**: `tlx.toki.id`, `api.tlx.toki.id`
- **PDF 处理**: 无
- **已知难点**:
  - SPA 需 Playwright
  - 部分题目含印尼语
- **限流**: 无
- **测试题号**: aplusb, tro-15-pengurangan, ioi-training-362, tk-sbp-10-horseshoe, tro-22-gunting, tro-13-flip
- **测试题号说明**:
  - `aplusb` — 基础验证
  - `ioi-training-362` — 题面较长
  - `tro-22-gunting` — 含图片（Scissors game）
  - `tk-sbp-10-horseshoe` — 多样化来源

---

### 11. LibreOJ (= LOJ)

- **标识**: `libreoj`
- **主页**: https://loj.ac
- **题面 URL**: `https://loj.ac/problem/{pid}`
- **题号格式**: `\d+`
- **页面类型**: **Playwright SPA**
- **HTML 结构**:
  - Vue/React SPA 渲染
  - 题面在 `.problem-content` 类似容器内
  - 使用通用 `convertHtmlToMarkdown()` 转换
- **图片域名**: `loj.ac`, `img.loj.ac`
- **PDF 处理**: 无
- **已知难点**:
  - **图片链接未下载** — 域名 `loj.ac` 不在图片白名单中
  - SPA 需 Playwright
  - 部分题目有复杂 LaTeX
- **限流**: 无
- **测试题号**: 1, 50, 100, 2336, 3165, 103
- **测试题号说明**:
  - `1` — 基础题（A+B Problem）
  - `100` — 题面较长（DZY Loves Math）
  - `2336` — 题面含图片（Farmcraft）
  - `3165` — 题面含图片（群体增强验证）

> **注意**: LOJ = LibreOJ，是同一个平台。`loj.ac` 即 LibreOJ。前端 `getOjProblemUrl()` 中 `case 'loj'` 应与 `case 'libreoj'` 指向同一 URL。

---

### 12. Yosupo (Library Checker)

- **标识**: `yosupo`
- **主页**: https://judge.yosupo.jp
- **题面 URL**: `https://judge.yosupo.jp/problem/{pid}`
- **题号格式**: slug（如 `aplusb`, `unionfind`, `lca`）
- **页面类型**: **Playwright SPA**
- **HTML 结构**:
  - SPA 渲染
  - 题面简洁（主要是数学描述）
- **图片域名**: 无
- **PDF 处理**: 无
- **已知难点**: 题面通常很短
- **测试题号**: aplusb, unionfind, lca, point_add_range_sum, dynamic_tree_subtree_add_subtree_sum, point_set_range_composite
- **测试题号说明**:
  - `aplusb` — 基础验证
  - `dynamic_tree_subtree_add_subtree_sum` — 题面含图片（Link/Cut Tree）
  - `point_set_range_composite` — 题面含 LaTeX 公式

---

### 13. 51Nod

- **标识**: `51nod`
- **主页**: https://www.51nod.com
- **题面 URL**: `https://www.51nod.com/Challenge/Problem.html#problemId={pid}`
- **题号格式**: `\d+`
- **页面类型**: **Playwright SPA**
- **HTML 结构**:
  - SPA 渲染，锚点导航
  - 题面在 `.problem-statement` 内
- **图片域名**: `www.51nod.com`, `cdn.51nod.com`
- **PDF 处理**: 无
- **已知难点**: SPA 需 Playwright
- **测试题号**: 1055, 1080, 1098, 1277, 1441, 1668
- **测试题号说明**:
  - `1055` — 题面含图片（最小距离之和）
  - `1277` — 题面较长（一个序列的问题）
  - `1668` — 题面含图片（非传统型题目验证）

---

### 14. CSAcademy

- **标识**: `csacademy`
- **主页**: https://csacademy.com
- **题面 URL**: `https://csacademy.com/contest/archive/task/{pid}/`
- **题号格式**: slug（如 `min-distances`, `aplusb`）
- **页面类型**: **Playwright SPA**
- **HTML 结构**: SPA 渲染
- **图片域名**: `csacademy.com`
- **PDF 处理**: 无
- **已知难点**: SPA 需 Playwright
- **测试题号**: aplusb, min-distances, is_prime, fraction, 8queens, guessinggame, hello, different, 4values, armystrengthhard, closestpair, increasingarray, repetitions, numbergrid, coinpile
- **测试题号说明**:
  - `aplusb` — 基础验证
  - `min-distances` — 题面含图片
  - `closestpair` — 题面较长复杂（Closest Pair）
  - `4values` — 含多个样例

---

### 15. Kattis

- **标识**: `kattis`
- **主页**: https://open.kattis.com
- **题面 URL**: `https://open.kattis.com/problems/{pid}`
- **题号格式**: `[a-z][a-z0-9_-]*`（slug）
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 题面在 `.problembody` 内
  - 样例: `table.sample` 内
  - 时限: `.metainfo` 内
- **图片域名**: `open.kattis.com`
- **PDF 处理**: 无（部分题目提供 PDF 下载链接）
- **已知难点**: 无特殊难点
- **测试题号**: aplusb, is_prime, fraction, 8queens, guessinggame, hello, different, 4values, armystrengthhard, quickbrownfox
- **测试题号说明**:
  - `aplusb` — 基础验证
  - `8queens` — 题面含图片（8 Queens）
  - `4values` — 题面较长（whose values are these）
  - `armystrengthhard` — 复杂题面验证

---

### 16. yukicoder

- **标识**: `yukicoder`
- **主页**: https://yukicoder.me
- **题面 URL**: `https://yukicoder.me/problems/no/{pid}`
- **题号格式**: `\d+`
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 容器: `.problem-body`
  - 各节: `h3` 标题分隔
  - 样例: `pre` 标签
- **图片域名**: `yukicoder.me`, `img.yukicoder.me`
- **PDF 处理**: 无
- **已知难点**: 日语为主
- **测试题号**: 1, 2, 100, 900, 2000, 4500
- **测试题号说明**:
  - `1` — 基础题（A+B Problem，验证基本拉取）
  - `100` — 中等难度（验证样例提取）
  - `900` — 较难问题（验证复杂题面解析）
  - `2000` — 可能含图片
  - `4500` — 较新题目，验证长期维护

---

### 17. VNOJ (VNOI Online Judge)

- **标识**: `vnoj`
- **主页**: https://oj.vnoi.info
- **题面 URL**: `https://oj.vnoi.info/problem/{pid}`
- **题号格式**: `[a-zA-Z0-9_-]+`（slug）
- **页面类型**: HTTP（API） + Cheerio
- **HTML 结构**:
  - 使用 DOMjudge 风格 API
  - 题面 HTML 在 JSON 响应中
- **图片域名**: `oj.vnoi.info`
- **PDF 处理**: 无
- **已知难点**: 越南语为主
- **测试题号**: QPALIN, NKFLOW, NKLEAGUE, mcoin, QBRECT, NKLOOK, VOI21GAME
- **测试题号说明**:
  - `QPALIN` — 基础题
  - `NKFLOW` — 网络流，题面较长
  - `QBRECT` — 题面含图片（最大矩形）
  - `VOI21GAME` — 越南 OI 题，题面复杂

---

### 18. Kilonova

- **标识**: `kilonova`
- **主页**: https://kilonova.ro
- **题面 URL**: `https://kilonova.ro/problems/{pid}`
- **题号格式**: `\d+`
- **页面类型**: HTTP + Cheerio
- **HTML 结构**: 标准题目页面
- **图片域名**: `kilonova.ro`
- **PDF 处理**: 无
- **已知难点**: 无特殊
- **测试题号**: 19, 45, 283, 576, 1032, 1498
- **测试题号说明**:
  - `19` — 基础验证
  - `576` — 题面含图片
  - `1032` — 题面较长复杂

---

### 19. oj.uz

- **标识**: `ojuz`
- **主页**: https://oj.uz
- **题面 URL**: `https://oj.uz/problem/view/{pid}`
- **题号格式**: `[a-zA-Z0-9_]+`
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 支持多种来源的题目
  - 部分题目为 PDF 题面
  - HTML 题面: `.statement-body`
- **图片域名**: `oj.uz`
- **PDF 处理**: ✅ 检测 PDF iframe 并下载
- **已知难点**:
  - 题面格式不统一（HTML / PDF / 外部链接）
  - 部分题目只有 PDF
- **测试题号**: CEOI11_balloon, IOI10_traffic, CEOI09_tri, BOI10_fence, CEOI12_job, IOI11_race
- **测试题号说明**:
  - `IOI10_traffic` — **PDF 题面**，验证 PDF 下载
  - `BOI10_fence` — HTML 题面较长
  - `CEOI12_job` — 题面含图片（Job Scheduling）

---

### 20. Aizu Online Judge

- **标识**: `aizu`
- **主页**: https://onlinejudge.u-aizu.ac.jp
- **题面 URL**: `https://onlinejudge.u-aizu.ac.jp/problems/{pid}`
- **题号格式**: `[A-Za-z0-9_]+`（如 `ALDS1_1_A`, `ITP1_1_A`）
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 容器: `#problem`
  - 各节: `h2` 标题
  - 样例: `pre` 标签
- **图片域名**: `onlinejudge.u-aizu.ac.jp`
- **PDF 处理**: 无
- **已知难点**: 日语 + 英语双语
- **测试题号**: ITP1_1_A, ALDS1_5_A, DPL_1_B, 0009, ITP1_2_C, ALDS1_4_D, DPL_2_A
- **测试题号说明**:
  - `0009` — 题面含图片（Shuffle The Cards）
  - `ALDS1_4_D` — 题面较长（Allocation）
  - `DPL_2_A` — 复杂图论题（Traveling Salesman Problem）

---

### 21. OpenJudge

- **标识**: `openjudge`（⚠️ 待拆分为 3 个子平台）
- **主页**: http://bailian.openjudge.cn（当前硬编码）
- **题面 URL**: `http://bailian.openjudge.cn/practice/{pid}/`
- **题号格式**: `\d+`
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 各节: `h4` 标题
  - 样例: `pre` 标签
- **图片域名**: `openjudge.cn`, `bailian.openjudge.cn`
- **PDF 处理**: 无
- **已知难点**:
  - **需拆分为 3 个子平台**（见下方）
  - 当前只支持百炼
- **测试题号**: 15, 28, 78, 43, 92, 101
- **测试题号说明**:
  - `15` — 基础验证
  - `43` — 题面含图片（Student Registration）
  - `92` — 题面较长复杂（背包变种）

#### 子平台拆分方案

| 新标识 | 域名 | URL 模板 | 题号格式 |
|--------|------|----------|----------|
| `openj_bailian` | `bailian.openjudge.cn` | `http://bailian.openjudge.cn/practice/{pid}/` | `\d+` |
| `openj_noi` | `noi.openjudge.cn` | `http://noi.openjudge.cn/{section}/{pid}/` | `\d{4,6}` |
| `openj_poj` | `poj.openjudge.cn` | `http://poj.openjudge.cn/practice/{pid}/` | `\d+` |

---

### 22. UOJ

- **标识**: `uoj`
- **主页**: https://uoj.ac
- **题面 URL**: `https://uoj.ac/problem/{pid}`
- **题号格式**: `\d+`
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 题面在 `article.uoj-article` 内
  - Markdown 渲染后的 HTML
  - 各节: `### Description`, `### Input` 等 Markdown 标题
- **图片域名**: `uoj.ac`
- **PDF 处理**: 无
- **已知难点**:
  - 部分题目有复杂 LaTeX
  - HTML 内混杂 Markdown 格式
- **测试题号**: 14, 75, 310, 50, 150, 211, 997
- **测试题号说明**:
  - `75` — 题面含图片（Repeatless Numbers）
  - `310` — 题面较长（Hexagon）
  - `997` — 复杂题面

---

### 23. CSG (CSGOJ)

- **标识**: `csg`
- **主页**: https://csgoj.com
- **题面 URL**: `https://csgoj.com/problem/{pid}`
- **题号格式**: `\d+`
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 各节: `<div name="xxx" class="md_display_div">` 包裹
  - 节标题: `<h2 class="text-info bilingual-inline">题目描述<span class="en-text">Description</span></h2>`
  - 样例: `<div name="Sample">` 内 `<textarea id="sample_input/output_hidden">`
- **图片域名**: `csgoj.com`
- **PDF 处理**: 无
- **已知难点**: 中英双语 HTML 结构
- **测试题号**: 1316, 1001, 2105, 1501, 1801, 2306

---

### 24. NowCoder (牛客)

- **标识**: `nowcoder`
- **主页**: https://ac.nowcoder.com
- **题面 URL**: `https://ac.nowcoder.com/acm/problem/{pid}`
- **题号格式**: `\d+`
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 题面: `.subject-describe` 内
  - OI 题描述: `.question-oi` 内
  - 样例: `textarea[data-clipboard-text-id]` 内
  - 结构非常复杂，含大量自定义 CSS class
- **图片域名**: `ac.nowcoder.com`, `uploadfiles.nowcoder.com`
- **PDF 处理**: 无
- **已知难点**:
  - **⚠️ Markdown 转换严重出错** — 通用 `convertHtmlToMarkdown()` 无法处理牛客的复杂 HTML
  - 需要专门的牛客 HTML 解析器
  - 样例提取逻辑不完善
- **测试题号**: 14776, 23485, 53377, 16676, 51236, 43722
- **测试题号说明**:
  - `14776` — 基础题（A+B Problem）
  - `53377` — 题面含图片
  - `43722` — 题面较长
  - `16676` — 含代码块验证

---

## 待实现适配器

### 25. Szkopuł (波兰 OI 平台)

- **标识**: `szkopul`
- **主页**: https://szkopul.edu.pl
- **题面 URL**: `https://szkopul.edu.pl/problemset/problem/{pid}/site/`
- **题号格式**: 字母数字 slug（如 `7FdDcCShZPh`, `aBcDeFg`）
- **页面类型**: HTTP + Cheerio（**天然 Markdown！**）
- **HTML 结构**:
  - 题面直接输出 Markdown 文本
  - 节标题: `##` heading
  - 图片: `![Image N](https://szkopul.edu.pl/images/...)`
  - 代码块: fenced code blocks
  - 样例: `### Przykładowe dane wejściowe/wyjściowe` (波兰语标题)
- **图片域名**: `szkopul.edu.pl`
- **PDF 处理**: 无
- **已知难点**:
  - 波兰语题面
  - 需翻译为中文
- **实现复杂度**: **低** — 天然 Markdown，几乎不需要解析
- **测试题号**: 7FdDcCShZPh, Ot7gKfBp1Bd, KwFuF0vxY2X, 5f4tGV3fNpX, e3wdtQPBwVZ, bYlV6jO7B1q
- **测试题号说明**:
  - `7FdDcCShZPh` — 基础验证（A+B）
  - `e3wdtQPBwVZ` — 题面含图片
  - `KwFuF0vxY2X` — 天然 Markdown 验证
  - `bYlV6jO7B1q` — 波兰语题面验证

---

### 26. DarkBZOJ (黑暗爆炸)

- **标识**: `darkbzoj`
- **主页**: https://darkbzoj.cc
- **题面 URL**: `https://darkbzoj.cc/problem/{pid}`
- **题号格式**: `\d+`
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 类 UOJ 风格
  - 各节: `### Description`, `### Input`, `### Output`, `### Sample Input`, `### Sample Output`, `### Hint`
  - 内容在 Markdown 渲染后的 HTML 中
- **图片域名**: `darkbzoj.cc`
- **PDF 处理**: 无
- **已知难点**:
  - BZOJ 原站已关闭，DarkBZOJ 是镜像
  - 部分题目题面不全
- **实现复杂度**: **中** — 与 UOJ 适配器高度相似，可复用解析逻辑
- **测试题号**: 1000, 1218, 3224, 4808, 2007, 3781
- **测试题号说明**:
  - `1000` — 基础题
  - `3224` — 题面含图片（田地竞赛）
  - `3781` — 题面较长复杂（Treelocking）

---

### 27. DMOJ (Don Mills Online Judge)

- **标识**: `dmoj`
- **主页**: https://dmoj.ca
- **题面 URL**: `https://dmoj.ca/problem/{pid}`
- **题号格式**: slug（如 `aplusb`, `ccc06s1`）
- **页面类型**: **API** — `/api/v2/problem/{code}` 返回 JSON
- **HTML 结构**:
  - API 返回 `content` 字段，含 HTML 题面
  - 样例在 HTML 内
- **图片域名**: `dmoj.ca`
- **PDF 处理**: 无
- **已知难点**:
  - 有 API 可用，实现简单
  - HTML 题面需 `convertHtmlToMarkdown()`
- **实现复杂度**: **低** — 有 API
- **测试题号**: aplusb, ccc06s1, dmopc19c5p1, arc106a, wc18c3j1, dmopc20c2p1, ccc20s1
- **测试题号说明**:
  - `aplusb` — 基础验证
  - `arc106a` — 含复杂 LaTeX 公式
  - `ccc20s1` — 题面含图片（Surveillance Camera）

---

### 28. Baekjoon (BOJ)

- **标识**: `baekjoon`
- **主页**: https://www.acmicpc.net
- **题面 URL**: `https://www.acmicpc.net/problem/{pid}`
- **题号格式**: `\d+`
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 容器: `#problem_description`
  - 各节: `#problem_input`, `#problem_output`, `#problem_sample`
  - 样例: `samp` 元素 + `pre` 标签
- **图片域名**: `onlinejudgeimages.s3-ap-northeast-1.amazonaws.com`, `cdn.jsdelivr.net`
- **PDF 处理**: 无
- **已知难点**:
  - **Cloudflare 保护** — 可能需要 Playwright 或 Cookie
  - 韩语为主
- **实现复杂度**: **中** — 可能需 Playwright
- **测试题号**: 1000, 1085, 2557, 14563, 25773, 30022, 40367
- **测试题号说明**:
  - `1000` — 基础题（A+B）
  - `14563` — 题面含图片验证
  - `25773` — 题面含复杂 LaTeX（模板字符串匹配）
  - `40367` — 题面较长

---

### 29. CodeChef

- **标识**: `codechef`
- **主页**: https://www.codechef.com
- **题面 URL**: `https://www.codechef.com/problems/{pid}`
- **题号格式**: 字母数字（如 `HS08TEST`, `FLOW001`）
- **页面类型**: **Playwright SPA**
- **HTML 结构**:
  - JS 重度渲染
  - React/Next.js SPA
- **图片域名**: `codechef.com`, `cdn.codechef.com`
- **PDF 处理**: 无
- **已知难点**:
  - **必须 Playwright**
  - Cloudflare 保护
  - 部分题目需登录
- **实现复杂度**: **高**
- **测试题号**: FIBOSUM, TEST, WILLITST, PALIN, AGEC, PRIME1, FCTRL2, NAKANJ, COCONUTS, SALARY
- **测试题号说明**:
  - `TEST` — 基础验证
  - `NAKANJ` — 题面含图片（Knight Moves）
  - `COCONUTS` — 题面含图片（Coconuts）
  - `FCTRL2` — 题面含多行文本（Big Factorial）

---

### 30. CSES Problem Set

- **标识**: `cses`
- **主页**: https://cses.fi
- **题面 URL**: `https://cses.fi/problemset/task/{pid}`
- **题号格式**: `\d+`
- **页面类型**: HTTP + Cheerio
- **HTML 结构**:
  - 简洁 HTML 页面
  - 各节明确分隔
- **图片域名**: 无
- **PDF 处理**: 无
- **已知难点**: 无特殊
- **实现复杂度**: **低**
- **测试题号**: 1068, 1083, 1641, 1755, 2220, 2417, 2923, 3507
- **测试题号说明**:
  - `1068` — 基础验证
  - `1641` — 题面含图片
  - `1755` — 题面含图片（Bracket Sequence）
  - `2923` — 题面较长
  - `3507` — 复杂题面验证

---

### 31. SPOJ

- **标识**: `spoj`
- **主页**: https://www.spoj.com
- **题面 URL**: `https://www.spoj.com/problems/{pid}`
- **题号格式**: 字母数字（如 `TEST`, `PRIME1`）
- **页面类型**: HTTP + Cheerio
- **HTML 结构**: 标准 HTML 页面
- **图片域名**: `spoj.com`
- **PDF 处理**: 无
- **已知难点**: 部分题目需登录
- **实现复杂度**: **中**
- **测试题号**: TEST, PRIME1, AGEC, PALIN, FCTRL2, WILLITST, FCTRL, EIGHTSQ
- **测试题号说明**:
  - `TEST` — 基础验证
  - `EIGHTSQ` — 题面含图片（Magic Square）

---

### 32. UVa Online Judge

- **标识**: `uva`
- **主页**: https://onlinejudge.org
- **题面 URL**: `https://onlinejudge.org/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem={pid}`
- **题号格式**: `\d+`
- **页面类型**: HTTP + Cheerio（PDF 为主）
- **HTML 结构**: 大部分题目以 PDF 形式提供
- **图片域名**: 无
- **PDF 处理**: ✅ 需下载 PDF 并上传
- **已知难点**:
  - 大部分题目只有 PDF
  - PDF 下载后需通过 FileService 上传
- **实现复杂度**: **高** — PDF 为主
- **测试题号**: 100, 102, 231, 488, 706, 793
- **测试题号说明**:
  - `100` — 经典基础题（3n+1 问题）
  - `488` — 题面含图片（Triangle Wave）
  - `706` — 题面含图片 + 较长（LCD Display）

---

### 33. BZOJ (原站)

- **标识**: `bzoj`
- **主页**: ~~https://www.lydsy.com/JudgeOnline~~ （已关闭）
- **题面 URL**: `https://www.lydsy.com/JudgeOnline/problem.php?id={pid}`
- **题号格式**: `\d+`
- **页面类型**: 不可用（原站已关闭）
- **建议**: 使用 `darkbzoj` 替代，或仅记录题号不支持拉取
- **实现复杂度**: **不可实现**

---

### 34. Vijos

- **标识**: `vijos`
- **主页**: https://vijos.org
- **题面 URL**: `https://vijos.org/p/{pid}`
- **题号格式**: `P\d+`
- **页面类型**: HTTP + Cheerio（需调研）
- **已知难点**: 需确认网站是否仍在线
- **实现复杂度**: **待调研**
- **测试题号**: P1000, P1040, P1841, P1983, P3377, P2002
- **测试题号说明**:
  - `P1000` — 基础验证
  - `P2002` — 题面含图片
  - `P3377` — 题面较长复杂

---

### 35. EOlymp

- **标识**: `eolymp`
- **主页**: https://www.eolymp.com
- **题面 URL**: `https://www.eolymp.com/en/problems/{pid}`
- **题号格式**: `\d+`
- **页面类型**: HTTP（可能有 API）
- **已知难点**: 需调研
- **实现复杂度**: **待调研**
- **测试题号**: 19, 45, 283, 576, 1032, 1498

---

### 36. HihoCoder

- **标识**: `hihocoder`
- **主页**: ~~https://hihocoder.com~~ （已关闭？）
- **页面类型**: 需确认
- **实现复杂度**: **待调研**

---

### 37. HackerRank

- **标识**: `hackerrank`
- **主页**: https://www.hackerrank.com
- **题面 URL**: `https://www.hackerrank.com/challenges/{pid}/problem`
- **题号格式**: slug
- **页面类型**: **Playwright SPA**
- **已知难点**: JS 渲染，需登录
- **实现复杂度**: **高**
- **测试题号**: dp-1-grid, seavote, stquery, min-max-asm, dominoes, balloons

---

### 38. TopCoder

- **标识**: `topcoder`
- **主页**: https://www.topcoder.com
- **页面类型**: **不可实现** — 完全 SPA + 登录墙
- **实现复杂度**: **不可实现**

---

## 不可实现平台

| 平台 | 原因 |
|------|------|
| BZOJ 原站 | 已关闭，使用 DarkBZOJ 替代 |
| TopCoder | 完全 SPA + 登录墙 |
| Z-Trening | 需登录，题目格式不标准 |
| LightOJ | 需登录，PDF 题面 |
| ZOJ | 已迁移到 PTA，原站不稳定 |
| SGU | 已关闭，题目迁移到其他 OJ |
| HUST | 内部 OJ |
| FZU | 偶尔在线，不稳定 |
| HRBUST | 内部 OJ |
| HIT | 内部 OJ |

---

## 前端 URL 映射

### 当前状态

`ProblemDetail.tsx` 中 `getOjProblemUrl()` 只覆盖 **11 个平台**，其余返回 `#`：

```typescript
// 当前覆盖
'luogu', 'codeforces', 'atcoder', 'loj', 'poj', 'hdu', 'spoj', 'uva', 'vijos', 'bzoj', 'qoj', 'gym'
// 共 12 个，缺少 12+ 个已有适配器
```

### 缺失的平台 URL

| 平台标识 | 应有 URL |
|----------|----------|
| `ural` | `https://acm.timus.ru/problem.aspx?space=1&num={pid}` |
| `usaco` | `https://usaco.org/index.php?page=viewproblem2&cpid={pid}` |
| `tlx` | `https://tlx.toki.id/problems/{pid}` |
| `libreoj` | `https://loj.ac/problem/{pid}` |
| `yosupo` | `https://judge.yosupo.jp/problem/{pid}` |
| `51nod` | `https://www.51nod.com/Challenge/Problem.html#problemId={pid}` |
| `csacademy` | `https://csacademy.com/contest/archive/task/{pid}/` |
| `kattis` | `https://open.kattis.com/problems/{pid}` |
| `yukicoder` | `https://yukicoder.me/problems/no/{pid}` |
| `vnoj` | `https://oj.vnoi.info/problem/{pid}` |
| `kilonova` | `https://kilonova.ro/problems/{pid}` |
| `ojuz` | `https://oj.uz/problem/view/{pid}` |
| `aizu` | `https://onlinejudge.u-aizu.ac.jp/problems/{pid}` |
| `openjudge` | `http://bailian.openjudge.cn/practice/{pid}/` |
| `uoj` | `https://uoj.ac/problem/{pid}` |
| `csg` | `https://csgoj.com/problem/{pid}` |
| `nowcoder` | `https://ac.nowcoder.com/acm/problem/{pid}` |

### 更好的方案

**优先使用后端存储的原题 URL**。后端 `ojBindings` 已存储 `{platform, problemId, url}`，前端 `OjBinding` 应增加 `url` 字段，直接使用后端存储的 URL，`getOjProblemUrl()` 仅作兜底。

---

## 图片下载管线

### 当前问题

`extractImageLinks()` 白名单只覆盖 3 个域名组：

```typescript
// 当前白名单
url.includes('luogu.com.cn') || url.includes('luogu') ||
url.includes('img.atcoder.jp') || url.includes('atcoder.jp') ||
url.includes('codeforces.com') || url.includes('pic.codeforces.com') ||
url.includes('espresso.codeforces.com')
```

**遗漏的平台图片**: LibreOJ, HDU, POJ, URAL, USACO, Kattis, yukicoder, VNOJ, Kilonova, oj.uz, Aizu, OpenJudge, UOJ, CSG, NowCoder, TLX, Yosupo, 51Nod, CSAcademy

### 修复方案

**移除白名单**，改为**下载所有非 data: 协议的图片**：

```typescript
function extractImageLinks(markdown: string) {
  // 下载所有 http/https 图片，不再限制域名
  // 排除已上传到本地的图片（/api/files/ 路径）
}
```

### Referer 头处理

按图片域名自动设置正确的 Referer：

| 图片域名 | Referer |
|----------|---------|
| `*.luogu.com.cn` | `https://www.luogu.com.cn/` |
| `*.atcoder.jp` | `https://atcoder.jp/` |
| `*.codeforces.com` | `https://codeforces.com/` |
| 其他 | 图片所在页面 URL（适配器提供） |

### PDF 统一上传

所有平台拉取的 PDF 题面统一通过 `fileService.upload()` 上传，返回 `/api/files/:id/public` URL。

---

## 实施优先级

### P0 — 阻塞性修复

1. **图片下载白名单扩大** → 移除白名单，下载所有外部图片
2. **前端原题链接** → `OjBinding` 增加 `url` 字段 + 补全 `getOjProblemUrl()`
3. **NowCoder Markdown 转换修复** → 专用解析器

### P1 — 质量提升

4. **LibreOJ 图片下载** → 域名加入管线
5. **USACO HTML 实体修复** → `unescapeHtml()` 处理顺序
6. **OpenJudge 拆分** → 3 个子适配器
7. **PDF 统一上传** → 确保所有平台 PDF 走 FileService

### P2 — 新增适配器

8. **Szkopuł** — 天然 Markdown，最简单
9. **DarkBZOJ** — 复用 UOJ 解析逻辑
10. **DMOJ** — 有 API，实现简单
11. **CSES** — 简洁 HTML
12. **Baekjoon** — 需处理 Cloudflare
13. **SPOJ** — 标准 HTML
14. **其他待调研平台**

---

## 术语对照

| 简称 | 全称 | 平台标识 |
|------|------|----------|
| LOJ / LibreOJ | Libre Online Judge | `libreoj` |
| CF | Codeforces | `codeforces` |
| AC | AtCoder | `atcoder` |
| LG | 洛谷 (Luogu) | `luogu` |
| BJ / BOJ | Baekjoon Online Judge | `baekjoon` |
| QOJ | Qingdao Online Judge | `qoj` |
| UOJ | Universal Online Judge | `uoj` |
| VNOJ | VNOI Online Judge | `vnoj` |
| CSES | Code Submission Evaluation System | `cses` |
| SPOJ | Sphere Online Judge | `spoj` |
| UVa | Universidad de Valladolid Online Judge | `uva` |
