# OJ 题目拉取适配器文档

> 最后更新: 2026-04-02

本文档记录所有已实现的 OJ 平台拉取适配器，包括技术方案、题号格式、能力边界和已知限制。

---

## 适配器总览

| 平台 | 标识 | 技术方案 | Cookie | 附件 | 多语言 | 限流 |
|------|------|---------|--------|------|--------|------|
| 洛谷 | `luogu` | HTTP + Cheerio | 可选（附件需要） | ✅ | ✅ 中/英 | 2 QPS |
| Codeforces | `codeforces` | HTTP + Cheerio + 洛谷兜底 | 不需要 | ❌ | ✅ 中/英 | 1 QPS |
| Gym | `gym` | HTTP + Cheerio（继承 CF） | 不需要 | ❌ | ✅ 中/英 | 1 QPS |
| AtCoder | `atcoder` | HTTP + Cheerio + 洛谷兜底 | 不需要 | ❌ | ✅ 中/英 | 1 QPS |
| QOJ | `qoj` | Playwright + Stealth | 不需要 | ❌ | ❌ | - |
| HDU | `hdu` | 纯 HTTP（GB2312） | 不需要 | ❌ | ✅ 中/英（自动检测） | - |

---

## 1. 洛谷 (Luogu)

**文件**: `apps/server/src/oj-adapters/luogu.ts`
**URL**: `https://www.luogu.com.cn/problem/{pid}`

### 题号格式
- 标准格式：`B2001`、`P1001`、`AT_abc100_a`、`CF2A`
- 洛谷同时收录了 CF、AT 等平台的题目，有独立题号

### 技术方案
- **HTTP 请求**：直接 fetch 页面 HTML
- **解析方式**：页面内嵌 `lentille-context` JSON 数据，用正则提取后 JSON.parse
- **HTML 清洗**：用 Cheerio 将 HTML 内容转为 Markdown
- **数学公式**：洛谷使用 `<span class="katex">` 渲染，提取原始 LaTeX 源码
- **限流**：2 QPS，抖动 0.10-0.35s，最大重试 3 次

### 能力
- ✅ 题面（中/英文双版本）
- ✅ 附件下载（需要 `LUOGU_COOKIE` 环境变量）
- ✅ 时限/内存限制
- ✅ 难度信息

### Cookie 配置
- 环境变量：`LUOGU_COOKIE`
- 字段：`__client_id`、`_uid`
- 未配置 Cookie 时仍可拉取题面，但附件下载可能返回 403

### 已知限制
- 部分附件需要登录才能下载（详见 KNOWN_ISSUES.md 2.6）

---

## 2. Codeforces

**文件**: `apps/server/src/oj-adapters/codeforces.ts`
**URL**: `https://codeforces.com/problemset/problem/{contestId}/{letter}`
**镜像**: `https://mirror.codeforces.com/problemset/problem/{contestId}/{letter}`

### 题号格式
- `{contestId}{letter}`，如 `2A`、`1450E`、`1840C`

### 技术方案
- **主站/镜像双源**：主站失败自动尝试镜像站
- **洛谷兜底**：两站都失败时，从洛谷拉取 `CF{contestId}{letter}`
- **HTML 解析**：Cheerio 解析 HTML 结构
- **数学公式**：`<span class="tex-span">` → `$...$`
- **特殊字体样式**：`<span class="tex-font-style-tt">` → `` `code` ``
- **限流**：1 QPS，抖动 0.5-1.5s，最大重试 3 次

### 能力
- ✅ 题面（HTML → Markdown）
- ✅ 中/英文双版本（洛谷兜底时提供中文）
- ✅ 时限/内存限制
- ❌ 附件（CF 没有附件）

### 已知限制
- display math 与文字同行时需特殊处理
- 相邻 inline math `$$` 可能冲突

---

## 3. Gym (Codeforces Gym)

**文件**: `apps/server/src/oj-adapters/gym.ts`
**URL**: `https://codeforces.com/gym/{contestId}/problem/{letter}`

### 题号格式
- `{contestId}{letter}`，如 `106449A`

### 技术方案
- **继承 CodeforcesAdapter**：复用 CF 的 HTML 解析逻辑
- **URL 区别**：使用 `/gym/` 路径而非 `/problemset/problem/`
- **无洛谷兜底**：洛谷不收录 Gym 题目

### 能力
- ✅ 题面（与 CF 相同）
- ✅ 时限/内存限制
- ❌ 洛谷兜底
- ❌ 附件

### 已知限制
- 部分 Gym 题目只有 PDF 版本，遇到时返回拉取失败

---

## 4. AtCoder

**文件**: `apps/server/src/oj-adapters/atcoder.ts`
**URL**: `https://atcoder.jp/contests/{contest_id}/tasks/{task_ref}?lang=en`

### 题号格式
- `{contest_id}_{task_letter}`，如 `arc216_a`、`abc100_a`
- 会自动映射为 AtCoder 内部 task 引用名

### 技术方案
- **HTML 解析**：Cheerio
- **洛谷兜底**：失败时从洛谷拉取 `AT_{contest_id}_{task_letter}`
- **数学公式**：`<span class="tex-span">` → `$...$`
- **限流**：1 QPS，抖动 0.3-1.0s，最大重试 3 次

### 能力
- ✅ 题面（HTML → Markdown）
- ✅ 中/英文双版本（洛谷兜底时提供中文）
- ✅ 时限/内存限制
- ❌ 附件

---

## 5. QOJ

**文件**: `apps/server/src/oj-adapters/qoj.ts`
**URL**: `https://qoj.ac/problem/{id}`

### 题号格式
- 纯数字，如 `60`、`1538`

### 技术方案
- **Playwright + headed 模式**：QOJ 需要 JS 渲染 + MathJax，且 Cloudflare 对 headless 严格检测
- **数学公式**：MathJax 渲染后提取 `<script type="math/tex">` 中的 LaTeX 源码
- **PDF 题面**：`download.php?type=statement&id={题目编号}` 直接下载 PDF
- **Cloudflare 防护**：headed 模式下 CF challenge 约 3 秒自动通过
- **独立浏览器实例**：PDF 下载使用独立浏览器（不经过 stealth 注入）

### 能力
- ✅ 题面（HTML + MathJax → Markdown）
- ✅ PDF 题面本地下载
- ✅ 时限/内存限制
- ❌ 多语言（仅英文）
- ❌ 附件

### Cookie 配置
- 环境变量：`QOJ_SESSION`
- 值：UOJSESSID cookie 值（登录 qoj.ac 后从浏览器 DevTools 获取）
- 未配置 Cookie 时仍可拉取题面，但 PDF 下载可能失败

### 已知限制
- **需要 headed 模式**：服务器需有显示器或 Xvfb 虚拟显示器
- **Cloudflare 拦截**：部分题目（如 1538、5341）触发 CF challenge，返回 403
- 需要 Playwright 运行环境
- 可通过 `BROWSER_PROXY` 环境变量配置住宅代理绕过

---

## 6. HDU

**文件**: `apps/server/src/oj-adapters/hdu.ts`
**URL**: `https://acm.hdu.edu.cn/showproblem.php?pid={id}`

### 题号格式
- 纯数字，如 `1000`、`7000`

### 技术方案
- **纯 HTTP**：不需要 Playwright
- **GB2312 解码**：`TextDecoder('gb2312')` 转换为 UTF-8
- **结构解析**：`<div class=panel_title>` + `<div class=panel_content>` 配对提取
- **数学公式**：直接保留 HDU 原有的 `$...$` 和 `$$...$$` LaTeX 格式（MathJax）
- **中英文检测**：中文字符占比 > 5% → 中文题面

### 能力
- ✅ 题面（中/英文自动检测）
- ✅ 时限/内存限制
- ✅ 数学公式
- ❌ 附件

### 时限格式
- `Time Limit: 4000/2000 MS (Java/Others)` → 取第一个数字
- 内存：`Memory Limit: 131072/131072 K` → /1024 转 MB

### 验证通过题目
- 1000（英文简单题）
- 7000（中文题、有 Hint）
- 6460（英文长题、有 Hint、display math）
- 5545（英文题）
- 7241（英文题、display math）

---

## 新增适配器指南

1. 在 `apps/server/src/oj-adapters/` 创建 `{platform}.ts`
2. 实现 `OjAdapter` 接口（`fetch`, `isValidProblemId`, `getProblemUrl`）
3. 在 `index.ts` 注册：import + 添加到 adapters Map + `supported: true`
4. 确保 `types.ts` 的 `OjPlatform` 和 `KNOWN_OJ_PLATFORMS` 已包含该平台
5. 前端 `lib/oj-platforms.ts` 确认平台已在列表中
6. 更新本文档

### 适配器接口

```typescript
interface OjAdapter {
  name: string                    // 平台显示名称
  platform: OjPlatform            // 平台标识符
  fetch(problemId: string): Promise<OjProblem>
  isValidProblemId(problemId: string): boolean
  getProblemUrl(problemId: string): string
  rateLimitConfig?: { ... }       // 可选限流配置
}
```
