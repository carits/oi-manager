/**
 * AI 翻译模块 — 类型定义
 *
 * 竞赛题面结构保护翻译器的核心类型。
 * 详见 docs/translate.md
 */

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
  | 'md_heading'        // ## 标题标记（不保护文字，只保护 # 符号数量）
  | 'md_table_border'   // | --- | --- | 表格分隔行
  | 'judge_literal'     // YES / NO / Alice / Bob / First / Second

// ===== 占位符 =====

export interface Placeholder {
  /** 占位符 ID，如 __CODE_1__ */
  id: string
  /** 被替换的原文 */
  original: string
  /** 占位符类型 */
  type: PlaceholderType
}

// ===== 保护结果 =====

export interface ProtectResult {
  /** 替换后的文本（含占位符） */
  protectedText: string
  /** 所有占位符列表 */
  placeholders: Placeholder[]
  /** 各类型数量统计 */
  stats: Record<PlaceholderType, number>
}

// ===== 翻译选项 =====

export interface TranslateOptions {
  /** 待翻译文本 */
  text: string
  /** 源语言（默认自动检测） */
  sourceLang?: Language
  /** 目标语言 */
  targetLang: Language
  /** OJ 平台 */
  platform?: Platform
  /** 输入格式（默认 markdown） */
  format?: InputFormat
  /** 输出模式（默认 text） */
  outputMode?: OutputMode
  /** 自定义术语表 */
  glossary?: Record<string, string>
  /** 翻译温度（默认 0.1） */
  temperature?: number
  /** 最大重试次数（默认 3） */
  maxRetries?: number
  /** 单次请求超时 ms（默认 60000） */
  timeout?: number
  /** 最大分块大小（默认 3000 字符） */
  maxChunkSize?: number
}

// ===== 翻译结果 =====

export interface TranslationResult {
  /** 翻译后的文本 */
  translated: string
  /** 源格式 */
  sourceFormat: InputFormat
  /** 元数据 */
  metadata: {
    chunksProcessed: number
    cached: boolean
    placeholdersProtected: number
    model: string
  }
  /** 诊断信息 */
  diagnostics: {
    warnings: string[]
    structureValid: boolean
    placeholderCountBefore: number
    placeholderCountAfter: number
  }
}

// ===== JSON 模式固定返回结构 =====

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

// ===== 校验结果 =====

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

// ===== DeepSeek API 调用选项 =====

export interface DeepSeekCallOptions {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  timeout?: number
  maxRetries?: number
}

// ===== DeepSeek API 调用结果 =====

export interface DeepSeekCallResult {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// ===== 缓存条目 =====

export interface CacheEntry {
  translated: string
  timestamp: number
  metadata: TranslationResult['metadata']
}
