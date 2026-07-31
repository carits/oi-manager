---
status: archived
audience: historical
last_verified: 2026-07-30
source_of_truth: historical snapshot
replacement: docs/architecture/modules/PROBLEMS_AND_OJ.md
---

> 历史文档：本文件保留当时的设计、调查或实现记录，不代表当前系统行为。请以 `docs/architecture/modules/PROBLEMS_AND_OJ.md` 为准。

# AI 翻译模块设计文档

> 状态：设计中
> 最后更新：2026-03-31

## 一、模块概述

### 目标

实现一个**结构保护翻译器**，用于竞赛题面的中英互译和格式修正。核心原则：

- **翻得对**：自然语言准确翻译
- **格式绝对不能炸**：代码块、公式、样例、URL 等结构内容零损坏

### 功能

| 功能 | 说明 |
|------|------|
| 翻译 | 中英互译题面，保留所有 Markdown 结构 |
| 格式化 | 修正拉取的原始题面（变量加 `$`，公式用 LaTeX） |
| 限流 | 非管理员 24h 内每题限 1 次翻译 + 1 次格式化 |

---

## 二、技术选型

| 项目 | 选择 | 理由 |
|------|------|------|
| API | DeepSeek OpenAI 兼容接口 | 官方推荐，128K 上下文 |
| SDK | `openai` npm 包 | 官方兼容，不用手搓 HTTP |
| 模型 | `deepseek-chat` | 稳定、快速、成本低 |
| 温度 | `0.1` | 翻译需低随机性 |

---

## 三、目录结构

```
apps/server/src/lib/ai-translate/
  ├── index.ts          # 模块统一导出
  ├── types.ts          # 所有类型定义
  ├── protect.ts        # 危险片段识别 → 占位符替换
  ├── restore.ts        # 占位符 → 原文还原
  ├── splitter.ts       # 长文本按段落分块
  ├── prompt.ts         # system / user prompt 构造
  ├── glossary.ts       # 术语表加载与合并
  ├── validate.ts       # 翻译后结构校验（9 项检查）
  ├── schemas.ts        # JSON schema 定义
  ├── cache.ts          # 应用侧翻译缓存
  ├── deepseek.ts       # DeepSeek API 封装（重试+超时）
  └── translate.ts      # 统一服务入口 translateDocument()

apps/server/tests/ai-translate/
  ├── protect.spec.ts           # 保护/还原单元测试
  ├── validate.spec.ts          # 校验单元测试
  ├── splitter.spec.ts          # 分块单元测试
  ├── glossary.spec.ts          # 术语表单元测试
  └── e2e-translation.spec.ts   # 端到端测试

apps/web/src/components/problem/
  ├── ProblemDetail.tsx   # 修改：右侧按钮栏 + AI 调用
  └── TranslateModal.tsx  # 新增：翻译目标语言选择弹窗
```

---

## 四、类型定义

```typescript
// ===== 基础类型 =====
export type InputFormat = 'markdown' | 'html' | 'plain'
export type OutputMode = 'text' | 'json'
export type Language = 'zh' | 'en'
export type Platform = 'codeforces' | 'atcoder' | 'luogu' | 'usaco' | 'other'

// ===== 占位符类型 =====
export type PlaceholderType =
  | 'fenced_code'       // ```代码块```
  | 'indented_code'     // 4空格/Tab缩进代码块
  | 'inline_code'       // `行内代码`
  | 'math_display'      // $$块公式$$
  | 'math_inline'       // $行内公式$
  | 'sample_input'      // 样例输入块
  | 'sample_output'     // 样例输出块
  | 'url'               // http(s)://...
  | 'file_path'         // xxx.in / xxx.out / xxx.cpp
  | 'html_tag'          // <tag>...</tag>
  | 'judge_literal'     // YES / NO / Alice / Bob / First / Second

// ===== 占位符 =====
export interface Placeholder {
  id: string            // 如 __CODE_1__
  original: string      // 被替换的原文
  type: PlaceholderType
}

// ===== 保护结果 =====
export interface ProtectResult {
  protectedText: string
  placeholders: Placeholder[]
  stats: Record<PlaceholderType, number>
}

// ===== 翻译选项 =====
export interface TranslateOptions {
  text: string
  sourceLang?: Language       // 默认自动检测
  targetLang: Language
  platform?: Platform
  format?: InputFormat        // 默认 markdown
  outputMode?: OutputMode     // 默认 text
  glossary?: Record<string, string>
  temperature?: number        // 默认 0.1
  maxRetries?: number         // 默认 3
  timeout?: number            // 默认 60000ms
  maxChunkSize?: number       // 默认 3000 字符
}

// ===== 翻译结果 =====
export interface TranslationResult {
  translated: string
  sourceFormat: InputFormat
  metadata: {
    chunksProcessed: number
    cached: boolean
    placeholdersProtected: number
    model: string
  }
  diagnostics: {
    warnings: string[]
    structureValid: boolean
    placeholderCountBefore: number
    placeholderCountAfter: number
  }
}

// ===== JSON 模式固定 schema =====
export interface JsonTranslationOutput {
  source_lang: string
  target_lang: string
  translated_text: string
  warnings: string[]
  preserved_counts: {
    code_blocks: number
    inline_code: number
    math: number
    urls: number
    samples: number
  }
}
```

---

## 五、处理流水线

```
输入文本
  │
  ▼
[1] protect() — 识别并保护危险片段
  │  ├─ fenced code blocks → __CODE_n__
  │  ├─ sample I/O blocks → __SAMPLE_IN_n__ / __SAMPLE_OUT_n__
  │  ├─ display math $$...$$ → __MATH_BLOCK_n__
  │  ├─ inline math $...$ → __MATH_n__
  │  ├─ inline code `...` → __INLINE_n__
  │  ├─ URLs → __URL_n__
  │  ├─ HTML tags → __HTML_n__
  │  ├─ judge literals → __LITERAL_n__
  │  └─ file names → __FILE_n__
  │
  ▼
[2] splitter() — 长文本分块（按段落边界，maxChunkSize=3000）
  │
  ▼
[3] 逐块调用 DeepSeek API
  │  ├─ 构造 prompt（含术语表、平台规则）
  │  ├─ 温度 0.1，低随机性
  │  └─ 失败重试（最多 3 次）
  │
  ▼
[4] restore() — 还原占位符（字节级一致）
  │
  ▼
[5] validate() — 结构校验（9 项检查）
  │  ├─ 占位符数量一致
  │  ├─ 代码块数量一致
  │  ├─ 行内代码数量一致
  │  ├─ 公式定界符数量一致
  │  ├─ URL 数量一致
  │  ├─ 样例数据块不变
  │  ├─ Markdown 标题层级不变
  │  ├─ 表格列数不变
  │  └─ 无残留占位符
  │
  ▼
输出 TranslationResult
```

### 失败降级链

```
重试当前块（3 次）
  → 缩小分块（减半）
    → 切换到 plain text 模式
      → 标记人工审查（不静默输出损坏结果）
```

---

## 六、模块详细设计

### 6.1 `protect.ts` — 危险片段保护

按优先级依次提取（先提取的不会被后续规则误匹配）：

```typescript
export function protect(text: string): ProtectResult

// 提取顺序：
// 1. fenced code blocks:  ```lang\n...\n```
// 2. sample blocks:       **样例输入**\n```\n...\n```
// 3. indented code:       行首 4 空格或 Tab
// 4. display math:        $$...$$
// 5. inline math:         $...$（排除 `...` 内和代码块内）
// 6. inline code:         `...`
// 7. URLs:                https?://\S+
// 8. HTML tags:           <tag...>...</tag>
// 9. judge literals:      独立的 YES/NO/Alice/Bob/First/Second
// 10. file paths:         \w+\.(in|out|cpp|py|java|pas|txt)
```

### 6.2 `restore.ts` — 占位符还原

```typescript
export function restore(text: string, placeholders: Placeholder[]): string
// 遍历映射表，替换 __XXX_n__ 回原文
// 校验：替换后的文本中不应残留 __XXX_ 模式
```

### 6.3 `splitter.ts` — 文本分块

```typescript
export function splitText(text: string, maxChunkSize = 3000): string[]
// 按 \n\n 段落边界拆分
// 不在代码块/公式中间拆分
// 样例解释与对应样例尽量在同一块
```

### 6.4 `glossary.ts` — 术语表

```typescript
// 三级术语合并：用户自定义 > 项目配置 > 平台默认
export function mergeGlossary(
  user?: Record<string, string>,
  project?: Record<string, string>
): Record<string, string>

// 平台默认术语
const PLATFORM_DEFAULTS: Record<string, string> = {
  'subsequence': '子序列',
  'substring': '子串',
  'permutation': '排列',
  'lexicographically': '字典序',
  'connected component': '连通块',
  'spanning tree': '生成树',
  'sample input': '样例输入',
  'sample output': '样例输出',
  // ...更多术语
}
```

### 6.5 `prompt.ts` — Prompt 构造

**System Prompt 核心规则**：

```
你是竞赛题面翻译引擎。
规则：
1. 只翻译自然语言文本
2. 不翻译 __XXX_n__ 占位符标记
3. 不修改段落结构、空行、标题层级、列表层级、表格结构
4. 不改变 YES/NO/Alice/Bob 等输出字面量
5. 保持术语一致（参考术语表）
6. 只输出翻译结果，不要解释
```

**User Prompt 模板**：

```
源语言: {sourceLang}
目标语言: {targetLang}
平台: {platform}
术语表: {glossary}

请翻译以下内容（{outputMode} 模式）：

{text}
```

### 6.6 `deepseek.ts` — API 封装

```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY,
})

interface CallOptions {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  timeout?: number
  maxRetries?: number
}

export async function callDeepSeek(options: CallOptions): Promise<{
  content: string
  usage?: { promptTokens: number; completionTokens: number }
}>
```

### 6.7 `cache.ts` — 翻译缓存

```typescript
// 缓存键 = hash(原文 + 源语言 + 目标语言 + 平台 + 术语表版本 + 模型名)
export class TranslationCache {
  get(key: string): string | null
  set(key: string, value: string, ttlMs?: number): void
  clear(): void
}
```

### 6.8 `validate.ts` — 结构校验

```typescript
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validate(
  original: string,
  translated: string,
  placeholders: Placeholder[]
): ValidationResult

// 9 项检查：
// 1. 占位符全部还原（无 __XXX_ 残留）
// 2. fenced code block 数量一致
// 3. inline code 数量一致
// 4. display math 数量一致（$$）
// 5. inline math 数量一致（$）
// 6. URL 数量一致
// 7. YES/NO/Alice/Bob 字面量未被翻译
// 8. Markdown 标题 ## 层级数量一致
// 9. 表格分隔行 | 数量一致
```

### 6.9 `translate.ts` — 统一入口

```typescript
export async function translateDocument(input: TranslateOptions): Promise<TranslationResult>

// 完整流水线：
// 1. 检查缓存
// 2. protect() — 保护危险片段
// 3. splitter() — 分块
// 4. 逐块翻译（含重试）
// 5. 合并翻译结果
// 6. restore() — 还原占位符
// 7. validate() — 校验
// 8. 写入缓存
// 9. 返回结果 + 诊断信息
```

---

## 七、环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DEEPSEEK_API_KEY` | — | **必填** API Key |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | API 地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型名 |
| `TRANSLATION_TEMPERATURE` | `0.1` | 翻译温度 |
| `TRANSLATION_MAX_TOKENS` | `4096` | 单次最大输出 token |
| `TRANSLATION_TIMEOUT_MS` | `60000` | 单次请求超时 |
| `TRANSLATION_ENABLE_CACHE` | `true` | 启用应用侧缓存 |

---

## 八、后端 API

### 8.1 `POST /api/problems/:id/ai/translate`

翻译题面到目标语言，创建新的 ProblemStatement。

**请求**：
```json
{ "targetLang": "en" }
```

**响应**：
```json
{
  "success": true,
  "data": {
    "statement": { "id": "...", "language": "en", "content": "..." },
    "diagnostics": { "warnings": [], "structureValid": true }
  }
}
```

**限流**：非管理员 24h 内每题限 1 次。

### 8.2 `POST /api/problems/:id/ai/format`

格式化当前题面（就地更新 content）。

**请求**：
```json
{ "statementId": "..." }
```

**响应**：同上

### 8.3 `GET /api/problems/:id/ai/usage`

查询当前用户的 AI 使用情况。

**响应**：
```json
{
  "success": true,
  "data": { "canTranslate": true, "canFormat": false }
}
```

---

## 九、数据库

### 新增模型

```prisma
model AiUsageLog {
  id         String   @id @default(uuid())
  userId     String
  problemId  String
  action     String   // 'translate' | 'format'
  createdAt  DateTime @default(now())

  @@index([userId, problemId, action, createdAt])
}
```

---

## 十、前端 UI

### 10.1 ProblemDetail 布局

题面内容区域改为左右分栏：

```
┌──────────────────────────────────┬──────────────┐
│ [版本选择下拉]                    │              │
│──────────────────────────────────│   [翻译]     │
│                                  │   [格式化]   │
│  Markdown 渲染的题面内容          │   [写思路]   │
│                                  │              │
└──────────────────────────────────┴──────────────┘
```

- 右侧按钮栏：宽度固定，竖直排列
- AI 按钮仅在 `format === 'markdown' && content` 时显示
- 写思路按钮始终显示
- 按钮状态受 `aiUsage` 和 `aiLoading` 控制

### 10.2 TranslateModal 弹窗

点击"翻译"按钮弹出：

```
┌─────────────────────────┐
│  翻译题面           [×] │
│                         │
│  目标语言               │
│  ┌─────────────────┐   │
│  │ English       ▼ │   │
│  └─────────────────┘   │
│                         │
│  [取消]     [确认翻译]  │
└─────────────────────────┘
```

- 下拉框只显示与当前语言不同的选项
- 当前语言 zh → 只有 "English"
- 当前语言 en → 只有 "中文"

---

## 十一、测试计划

### 单元测试

| 测试文件 | 覆盖内容 |
|----------|----------|
| `protect.spec.ts` | 10 类片段的保护与还原、嵌套处理、冲突处理 |
| `validate.spec.ts` | 9 项校验规则的正反面 |
| `splitter.spec.ts` | 短文本/长文本/边界保护 |
| `glossary.spec.ts` | 默认术语、合并、优先级 |

### 端到端测试

| 场景 | 验证点 |
|------|--------|
| Codeforces 风格题面 | 代码块、YES/NO 不变 |
| 含大量公式的题面 | LaTeX 公式不变 |
| USACO 文件 I/O 题面 | 文件名 .in/.out 不变 |
| 洛谷特殊标记题面 | 平台标记不变 |
| 超长题面 | 切分翻译 + 合并正确 |
| 格式化功能 | 变量加 $、公式规范化 |

### 验收红线

只要出现以下任一情况即为失败：

- 代码块字符变化
- 样例数据变化
- Markdown 结构损坏
- 公式定界符损坏
- YES/NO 被翻译
- 文件名被翻译
- 占位符数量不一致
- 校验不通过

---

## 十二、实施顺序

1. `pnpm add openai`
2. `types.ts` 类型定义
3. `protect.ts` + `restore.ts`（最核心）
4. `splitter.ts`
5. `glossary.ts`
6. `prompt.ts`
7. `deepseek.ts`
8. `cache.ts`
9. `validate.ts`
10. `translate.ts` 统一入口
11. `index.ts` 模块导出
12. 单元测试
13. Prisma 模型 + `prisma:push`
14. 后端 API 端点
15. 前端 UI
16. 端到端测试
17. 更新 CLAUDE.md
