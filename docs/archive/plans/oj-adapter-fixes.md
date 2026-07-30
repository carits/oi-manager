---
status: archived
audience: historical
last_verified: 2026-07-30
source_of_truth: historical snapshot
replacement: docs/architecture/modules/PROBLEMS_AND_OJ.md
---

> 历史文档：本文件保留当时的设计、调查或实现记录，不代表当前系统行为。请以 `docs/architecture/modules/PROBLEMS_AND_OJ.md` 为准。

# OJ 适配器缺陷修复方案

> 最后更新: 2026-04-03
> 状态: 设计阶段

本文档按优先级列出所有已有适配器的已知 bug 和修复方案。

---

## P0 — 阻塞性问题

### 1. 图片下载白名单过于严格

**影响**: 所有适配器（除 luogu/CF/AtCoder 外）的图片不会被下载

**当前代码** (`oj-fetcher.ts` `extractImageLinks()`):
```typescript
// 只处理这 3 个域名的图片
url.includes('luogu') ||
url.includes('atcoder') ||
url.includes('codeforces')
```

**修复方案**:
- 移除域名白名单
- 改为下载所有 `http://` / `https://` 开头的图片 URL
- 排除已上传到本地的图片（`/api/files/` 路径）
- 排除 `data:` 协议图片

**涉及文件**:
- `apps/server/src/routes/oj-fetcher.ts` — `extractImageLinks()`

**验证**: 拉取 LibreOJ #1（含图片的题目），检查图片是否被下载并替换

---

### 2. 前端原题链接不完整

**影响**: 题目详情页 "原题链接" 对 17 个已有适配器返回 `#`

**根因**: `ProblemDetail.tsx` `getOjProblemUrl()` 只覆盖 12 个平台

**修复方案** (两步走):

#### 步骤 A: 后端存储的 URL 优先（推荐）

1. 前端 `OjBinding` 接口增加 `url` 字段
2. `ProblemDetail.tsx` 优先使用 `binding.url`
3. `getOjProblemUrl()` 仅作兜底

```typescript
// ProblemDetail.tsx
interface OjBinding {
  platform: string
  problemId: string
  url?: string  // 新增：后端存储的原题 URL
}

// 使用逻辑
const problemUrl = binding.url || getOjProblemUrl(binding.platform, binding.problemId) || '#'
```

#### 步骤 B: 补全 `getOjProblemUrl()` 覆盖所有平台

在 `getOjProblemUrl()` 中增加缺失的 17 个平台 case。

**涉及文件**:
- `apps/web/src/components/problem/ProblemDetail.tsx` — `OjBinding` 接口 + 链接逻辑
- `apps/web/src/components/problem/ProblemNote.tsx` — 同样有原题链接
- `apps/server/src/routes/problems.ts` — API 返回时需包含 `ojBindings[].url`

**验证**: 打开不同平台的题目详情页，检查 "原题链接" 是否正确

---

### 3. NowCoder Markdown 转换严重出错

**影响**: 牛客题目拉取后题面格式混乱

**根因**: 牛客 HTML 结构复杂，通用 `convertHtmlToMarkdown()` 无法处理：
- `.subject-describe` 内含多层嵌套 div
- `.question-oi` 内含 OI 题特殊结构
- `textarea[data-clipboard-text-id]` 样例提取不完善
- HTML 实体、特殊标签未正确处理

**修复方案**:
1. 为牛客编写专用 HTML 解析器
2. 不使用通用 `convertHtmlToMarkdown()`
3. 按 DOM 结构逐节提取：

```typescript
// 牛客专用解析流程
function parseNowcoderHtml(html: string): string {
  const $ = cheerio.load(html)

  // 1. 提取题目描述
  const description = $('.subject-describe').html() || ''

  // 2. 提取 OI 题描述（如果有）
  const oiDesc = $('.question-oi-describe').html() || ''

  // 3. 提取样例（从 textarea data-clipboard-text-id）
  const samples = extractNowcoderSamples($)

  // 4. 专用 HTML→Markdown 转换
  // ...
}
```

**涉及文件**:
- `apps/server/src/oj-adapters/nowcoder.ts` — 重写解析逻辑
- 可能新增 `apps/server/src/oj-adapters/nowcoder-parser.ts`

**验证**: 拉取牛客 #1、#14523，检查 Markdown 输出质量

---

## P1 — 质量提升

### 4. LibreOJ (LOJ) 图片不下载

**影响**: LibreOJ 题目中的图片保持外部链接，可能失效

**根因**: P0 修复（移除白名单）后自动解决

**额外处理**:
- LibreOJ 图片域名 `loj.ac` / `img.loj.ac` 的 Referer 设置
- 确保 Playwright 渲染后图片 URL 为绝对路径

**涉及文件**: 同 P0.1

**验证**: 拉取 LibreOJ #100（含图片题目）

---

### 5. USACO `&gt;` 等 HTML 实体未正确解码

**影响**: USACO 题目中出现 `&gt;`、`&lt;` 等未解码实体

**根因**: `unescapeHtml()` 在 `convertHtmlToMarkdown()` 中的调用顺序问题
- `stripTags()` 先于 `unescapeHtml()` 执行
- 如果 HTML 标签内含实体，可能在 stripTags 时产生意外结果

**当前 `unescapeHtml()` 处理顺序**:
```
&amp; → & (先处理)
&lt;  → <
&gt;  → >
&quot; → "
&#39; → '
```

**修复方案**:
1. 确保 `&amp;` 最先解码（当前已是，正确）
2. 在 `convertHtmlToMarkdown()` 末尾添加二次 `unescapeHtml()` 调用
3. 或在 USACO 适配器中增加后处理步骤

**涉及文件**:
- `apps/server/src/oj-adapters/html-utils.ts` — `convertHtmlToMarkdown()` 末尾
- `apps/server/src/oj-adapters/usaco.ts` — 可选的后处理

**验证**: 拉取 USACO #1、#103，检查 `>` `<` 是否正确显示

---

### 6. OpenJudge 拆分为 3 个子平台

**影响**: 当前只支持 `bailian.openjudge.cn`，`noi` 和 `poj` 子站不可用

**修复方案**:

#### 步骤 1: 新增平台标识

在 `types.ts` 中增加：
```typescript
// OjPlatform 联合类型新增
'openj_bailian' | 'openj_noi' | 'openj_poj'
```

在 `KNOWN_OJ_PLATFORMS` 中增加：
```typescript
{ value: 'openj_bailian', label: 'OpenJudge 百炼' },
{ value: 'openj_noi', label: 'OpenJudge NOI' },
{ value: 'openj_poj', label: 'OpenJudge POJ' },
```

#### 步骤 2: 拆分适配器

```
openjudge.ts → openj_bailian.ts + openj_noi.ts + openj_poj.ts
```

| 子平台 | 域名 | URL 模板 | 题号特点 |
|--------|------|----------|----------|
| `openj_bailian` | `bailian.openjudge.cn` | `/practice/{pid}/` | 纯数字 |
| `openj_noi` | `noi.openjudge.cn` | `/{section}/{pid}/` | 数字，需 section 前缀 |
| `openj_poj` | `poj.openjudge.cn` | `/practice/{pid}/` | 纯数字 |

#### 步骤 3: 注册和更新

- `index.ts` 注册 3 个新适配器
- 保留旧 `openjudge` 作为 `openj_bailian` 的别名（向后兼容）
- 前端 `oj-platforms.ts` 更新

**涉及文件**:
- `apps/server/src/oj-adapters/types.ts`
- `apps/server/src/oj-adapters/openjudge.ts` → 拆分为 3 个文件
- `apps/server/src/oj-adapters/index.ts`
- `apps/web/src/lib/oj-platforms.ts`

**验证**: 拉取百炼 #1, NOI 题目, POJ 题目

---

### 7. PDF 统一上传检查

**影响**: 确保所有平台 PDF 题面通过 FileService 上传

**当前状态**:
- ✅ QOJ: PDF 通过 `savePdfToLocal()` → FileService
- ✅ oj.uz: PDF 检测并提示（但未实际下载上传）
- ❌ 其他平台: 未处理 PDF

**修复方案**:
1. 确认 oj.uz 的 PDF 是否实际下载上传
2. 未来新增平台（UVa 等 PDF 为主的平台）需统一走 FileService
3. 所有 PDF URL 格式: `/api/files/:id/public`

**涉及文件**: 各适配器的 PDF 处理逻辑

---

## P2 — 可选优化

### 8. 洛谷附件下载优化

**影响**: 未配置 Cookie 时部分附件 403

**当前方案**: 配置 `LUOGU_COOKIE` 环境变量

**改进**: 在拉取日志中明确提示哪些附件因无 Cookie 而失败

---

### 9. AtCoder 数学公式转换

**影响**: AtCoder `<var>` 标签内的数学表达式转 Markdown 不完美

**改进**: 增强 `<var>` → `$...$` 转换逻辑，处理嵌套 `<sup>/<sub>`

---

### 10. Codeforces 兜底链路

**影响**: CF 主站 + 镜像都失败时，从洛谷拉取 `CF{pid}` 兜底

**当前状态**: ✅ 已实现

**潜在问题**: 洛谷 CF 题面可能与 CF 原站有差异

---

### 11. CSG 双语 HTML 解析

**影响**: CSG 题面中英双语混合，Markdown 转换可能丢失结构

**改进**: 按语言分别提取，存为多语言 statements

---

### 12. HTML→Markdown 通用转换器增强

**影响**: `convertHtmlToMarkdown()` 对复杂 HTML 处理不完美

**改进方向**:
- 表格支持（`<table>` → Markdown table）
- 更好的列表嵌套处理
- CSS class 语义识别（如 `.mathjax` → LaTeX）
- 自定义容器处理（`<div class="xxx">`）

---

## 修复检查清单

每个修复完成后，需验证：

- [ ] 适配器 `fetch()` 返回的 Markdown 格式正确
- [ ] 样例输入/输出格式正确（代码块包裹）
- [ ] 图片 URL 被替换为本地 `/api/files/:id/public`
- [ ] PDF 通过 FileService 上传并返回正确 URL
- [ ] `getProblemUrl()` 返回可访问的原题链接
- [ ] `isValidProblemId()` 正确验证题号格式
- [ ] 前端 "原题链接" 可点击且正确跳转
- [ ] 限流配置合理，不会触发平台封禁
