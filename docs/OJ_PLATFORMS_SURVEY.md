# OJ 平台拉取能力汇总

> 最后更新: 2026-04-03
> 
> 本文档汇总项目已接入和待接入的 OJ 平台状态，包括可访问性、技术方案、鉴权需求、题面格式等信息。

---

## 一、已实现适配器的平台（24 个）

| 平台 | 标识 | 状态 | 技术方案 | Cookie | PDF | 附件 | 多语言 | 特殊说明 |
|------|------|------|---------|--------|-----|------|--------|---------|
| 洛谷 | `luogu` | ✅ 可用 | HTTP + Cheerio | 可选（附件需 `LUOGU_COOKIE`） | ❌ | ✅ | ✅ 中/英 | 2 QPS 限流 |
| Codeforces | `codeforces` | ✅ 可用 | HTTP + Cheerio + 洛谷兜底 | 不需要 | ❌ | ❌ | ✅ 中/英 | 1 QPS，主站/镜像双源 |
| Gym | `gym` | ✅ 可用 | HTTP + Cheerio（继承 CF） | 不需要 | ❌ | ❌ | ✅ 中/英 | 无洛谷兜底，部分仅 PDF |
| AtCoder | `atcoder` | ✅ 可用 | HTTP + Cheerio + 洛谷兜底 | 不需要 | ❌ | ❌ | ✅ 中/英 | 1 QPS，自动映射 Task 引用名 |
| QOJ | `qoj` | ✅ 可用 | Playwright headed + 独立浏览器 | 需要 `QOJ_SESSION` | ✅ | ❌ | ❌ 仅英文 | CF 防护严格，需 headed 模式 + UOJSESSID |
| HDU | `hdu` | ✅ 可用 | 纯 HTTP（GB2312） | 不需要 | ❌ | ❌ | ✅ 自动检测 | 中文字符占比判断语言 |
| POJ | `poj` | ✅ 可用 | 纯 HTTP | 不需要 | ❌ | ❌ | ❌ 仅英文 | 老牌 OJ，HTML 结构简单 |
| URAL | `ural` | ✅ 可用 | 纯 HTTP | 不需要 | ❌ | ❌ | ❌ 仅英文 | 俄罗斯 OJ，HTML 结构规范 |
| USACO | `usaco` | ✅ 可用 | 纯 HTTP + MathJax | 不需要 | ❌ | ❌ | ❌ 仅英文 | 使用 `cpid` 题号，非传统题号 |
| TLX (TOKI) | `tlx` | ✅ 可用 | Playwright | 不需要 | ❌ | ❌ | ❌ 仅英文 | 印尼 OJ |
| LibreOJ | `libreoj` | ✅ 可用 | Playwright | 不需要 | ❌ | ❌ | ✅ 中/英 | 中文 OJ，社区维护 |
| Yosupo | `yosupo` | ✅ 可用 | Playwright | 不需要 | ❌ | ❌ | ❌ 仅英文 | Library Checker，题目以算法命名 |
| 51Nod | `51nod` | ✅ 可用 | Playwright/AJAX | 不需要 | ❌ | ❌ | ❌ 仅英文 | 题目数据通过 AJAX API 返回 |
| CSAcademy | `csacademy` | ✅ 可用 | Playwright | 不需要 | ❌ | ❌ | ❌ 仅英文 | 部分题目有 Editorials |
| Kattis | `kattis` | ✅ 可用 | 纯 HTTP | 不需要 | ❌ | ❌ | ❌ 仅英文 | 瑞典 OJ，结构清晰 HTML |
| Yukicoder | `yukicoder` | ✅ 可用 | 纯 HTTP + KaTeX | 不需要 | ❌ | ❌ | ❌ 日/英 | 日本 OJ，KaTeX `\(...\)` → `$...$` |
| VNOJ | `vnoj` | ✅ 可用 | 纯 HTTP | 不需要 | ❌ | ❌ | ❌ 越南语 | 基于 DMOJ，`~...~` → `$...$` |
| Kilonova | `kilonova` | ✅ 可用 | 纯 HTTP | 不需要 | ❌ | ❌ | ❌ 英/罗 | 罗马尼亚 OJ，已渲染 HTML |
| oj.uz | `ojuz` | ✅ 可用 | 纯 HTTP（PDF 提取） | 不需要 | ✅ | ✅ | ❌ 英/韩 | 多数题目为 PDF，可提取附件 |
| Aizu | `aizu` | ✅ 可用 | 纯 HTTP + API | 不需要 | ❌ | ❌ | ❌ 英/日 | 日本 OJ，标题/时限通过 AJAX API 获取 |
| OpenJudge | `openjudge` | ✅ 可用 | 纯 HTTP | 不需要 | ❌ | ❌ | ✅ 中/英 | 百练平台，`<dt>`/`<dd>` 结构 |
| UOJ | `uoj` | ✅ 可用 | 纯 HTTP | 不需要 | ❌ | ❌ | ✅ 中/英 | 通用 OJ，MathJax + 标准 HTML |
| CSG OJ | `csg` | ✅ 可用 | 纯 HTTP | 不需要 | ❌ | ❌ | ✅ 中/英 | 基于 CSGOJ 框架，Markdown 渲染后 HTML |
| NowCoder | `nowcoder` | ✅ 可用 | 纯 HTTP | 不需要 | ❌ | ❌ | ✅ 中/英 | 牛客竞赛，样例在 textarea 中 |

---

## 二、Cloudflare 保护的平台（需要特殊处理）

| 平台 | CF 检测 | HTTP 状态 | 技术方案 | Cookie | PDF | 特殊说明 |
|------|---------|---------|---------|--------|-----|---------|
| BOJ (Baekjoon) | ✅ 严格 | 403 | 需 headed 浏览器 或 API | ❌ | ❌ | 韩国最大 OJ，有非官方 API |
| DarkBZOJ | 可能 CF | 超时 | 可能需要代理 | ❌ | ❌ | BZOJ 的 CF 镜像站，不稳定 |
| UESTC (CDOJ) | ✅ | 403 | 需要 cookie 或 Playwright | 可能需要 | ❌ | 电子科技大学 OJ |
| DMOJ | 无 CF | 正常 | 有公开 API (`/api/v2/problem/{code}`) | ❌ | ❌ | 加拿大平台，有 REST API |
| Szkopul | ✅ | 302 CF challenge | 需要 Playwright | ❌ | ❌ | 波兰 OJ，CF Turnstile 验证 |

---

## 三、已失效/不可达的平台

| 平台 | 错误 | 状态 | 备注 |
|------|------|------|------|
| ACdream | `ENOTFOUND` | ❌ **DNS 失效** | 域名已无法解析 |
| NBUT | `ENOTFOUND` | ❌ **DNS 失效** | 南昌理工学院 OJ，域名已失效 |
| HihoCoder | `CERT_HAS_EXPIRED` | ❌ **SSL 证书过期** | 微软在线编程平台，可能已停运 |
| SGU | 404 | ❌ **页面不存在** | 萨拉托夫国立大学 OJ，可能已迁移 |
| EIJudge | 404 | ❌ **页面不存在** | 莫斯科物理技术学院 OJ，URL 可能变了 |
| SCU | 404 | ❌ **页面不存在** | 四川大学 OJ，可能已迁移 |
| ZOJ | 404 | ❌ **页面不存在** | 浙江大学 OJ，题目编号不同 |
| BZOJ (lydsy) | TIMEOUT | ⚠️ **疑似失效** | 原始 BZOJ 已关闭，DarkBZOJ 为镜像 |
| KRSU | 401 | ⚠️ **需要登录** | 吉尔吉斯-俄罗斯斯拉夫大学 OJ |
| TopCoder | RACE_TIMEOUT | ⚠️ **Archive 模式** | 已被收购，题目在 archive.topcoder.com |

---

## 四、需要登录/Cookie 的平台

| 平台 | 鉴权方式 | 题面可见性 | 备注 |
|------|---------|-----------|------|
| 洛谷 | Cookie (`LUOGU_COOKIE`) | 题面公开，附件需登录 | `__client_id` + `_uid` |
| QOJ | Cookie (`QOJ_SESSION`) | 题面公开，PDF 需通过 CF | `UOJSESSID` |
| KRSU | 账号登录 | 需要登录才能查看 | 401 Unauthorized |
| HackerRank | 账号登录 | 部分题目公开 | 建议通过 API 获取 |

---

## 五、PDF 题面特殊处理

| 平台 | PDF 来源 | 处理方式 | 备注 |
|------|---------|---------|------|
| QOJ | `download.php?type=statement&id={pid}` | headed 浏览器下载到本地 | CF 严格保护，需独立浏览器实例 |
| oj.uz | PDF viewer iframe | 提取 `file=` 参数，返回直接 PDF URL | 多数题目为 PDF 题面 |
| Codeforces Gym | 部分 PDF 题面 | 外部 URL 引用 | Gym 部分题目只有 PDF |
| USACO | HTML 题面（含 MathJax） | 纯 HTTP 提取，数学公式保留 | 部分老题有 PDF 版本 |

---

## 六、公开 API 的平台

| 平台 | API 地址 | 格式 | 鉴权 | 备注 |
|------|---------|------|------|------|
| DMOJ | `/api/v2/problem/{code}` | JSON | 不需要 | 完整的题目数据，但网站有 CF 保护 |
| Codeforces | `/api/problemset.problems` | JSON | 不需要 | 题目列表，不含题面内容 |

---

## 七、特殊题面格式注意

| 格式 | 出现平台 | 处理方式 |
|------|---------|---------|
| MathJax LaTeX | 洛谷、QOJ、AtCoder、CF、USACO | 提取 `math/tex` 或 `$...$` → Markdown `$...$` |
| KaTeX `\(...\)` | Yukicoder | `\(…\)` → `$…$`，`\[…\]` → `$$…$$` |
| DMOJ `~...~` | VNOJ | `~…~` → `$…$` |
| GB2312 编码 | HDU | `TextDecoder('gb2312')` → UTF-8 |
| PDF 题面 | QOJ、oj.uz、Gym | 下载到本地或提取 URL，前端 PDF 查看器 |
| Vue/React SPA | LibreOJ、Yosupo、CSAcademy | 需要 Playwright 渲染后提取 |
| AJAX 数据 | 51Nod | 拦截 API 请求获取 JSON |
| CF JS Challenge | QOJ、BOJ、UESTC、Szkopul | headed 模式浏览器 + 等待自动通过 |

---

## 八、按实现状态汇总

### 已实现（19 个）
| 优先级 | 平台 | 技术方案 | 验证状态 |
|--------|------|---------|---------|
| P0 | 洛谷、Codeforces、Gym、AtCoder、QOJ、HDU | HTTP / Playwright | ✅ 已验证 |
| P0 | POJ、URAL、USACO | 纯 HTTP | ✅ 已验证 |
| P1 | TLX、LibreOJ、Yosupo、51Nod、CSAcademy | Playwright | ✅ 编译通过，需 Playwright 环境验证 |
| P3 | Kattis、Yukicoder、VNOJ、Kilonova、oj.uz | 纯 HTTP | ✅ 已验证 |

### 待实现（CF 保护或需特殊处理）
| 平台 | 难度 | 主要障碍 |
|------|------|---------|
| BOJ | ⭐⭐⭐ | CF 严格保护 + 韩文 |
| DMOJ | ⭐⭐ | 有 API 但网站有 CF 保护 |
| Szkopul | ⭐⭐⭐ | CF Turnstile 验证 |
| UESTC | ⭐⭐⭐ | CF + Cookie |

### 不可用
| 平台 | 原因 |
|------|------|
| ACdream、NBUT | DNS 失效 |
| HihoCoder | SSL 证书过期 |
| SGU、EIJudge、SCU、ZOJ | 页面 404 |
| BZOJ (lydsy) | 已关闭 |
| DarkBZOJ | 不稳定/超时 |
