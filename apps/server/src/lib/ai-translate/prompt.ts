/**
 * prompt.ts — 系统/用户 prompt 构造
 *
 * 固定 prompt 体系，不让 AI 自由发挥。
 */

import type { Language, Platform, OutputMode } from './types'
import { formatGlossaryForPrompt, getPlatformRules } from './glossary'

// ===== 系统 Prompt =====

const SYSTEM_PROMPT_BASE = `你是竞赛题面翻译引擎。

## 核心规则
1. 只翻译自然语言文本
2. 不翻译占位符标记（__XXX_n__ 格式），保持原样
3. 不翻译代码、公式、样例输入输出、占位符、文件名、URL、HTML标签
4. 不修改段落结构、空行、标题层级、列表层级、表格结构
5. 不改变 YES、NO、Alice、Bob、First、Second 等输出字面量
6. 不改变 stdin/stdout、sort.in/sort.out 等文件 I/O 标识
7. 不改变代码块语言标记（如 cpp、python）
8. 不把 <= 改成 ≤，不把 ... 改成 ……
9. 保持术语一致性（参考术语表）
10. 只输出翻译结果，不要解释

## 格式保护
- Markdown 标题层级（#、##、###）的数量和位置不能变
- 列表缩进层级不能变
- 表格结构（| 分隔符数量）不能变
- 代码块的开闭标记不能变
- 公式定界符（$...$ 和 $$...$$）不能变

## 数学公式保护（重要）
- 数学公式内部的 \$ 表示字面美元符号（如 $\\$1$ 表示"$1"），翻译时保持 \$ 不变
- 不要把 $\\$ 误认为 $$ (display math) 的开始或结束
- 数学定界符内的所有 LaTeX 命令保持原样，不翻译命令名
- 示例："costs $\\$3$" 翻译为 "花费 $\\$3$"，其中 \\$ 保持不变`

// ===== 用户 Prompt =====

interface UserPromptOptions {
  sourceLang: Language
  targetLang: Language
  platform?: Platform
  glossary?: Record<string, string>
  outputMode?: OutputMode
}

const LANGUAGE_NAMES: Record<Language, string> = {
  zh: '中文',
  en: 'English',
}

/**
 * 构造系统 prompt
 */
export function buildSystemPrompt(platform?: Platform): string {
  const rules = getPlatformRules(platform)
  if (rules.length === 0) return SYSTEM_PROMPT_BASE

  return SYSTEM_PROMPT_BASE + '\n\n## 平台特殊规则\n' + rules.map(r => `- ${r}`).join('\n')
}

/**
 * 构造用户 prompt
 */
export function buildUserPrompt(text: string, options: UserPromptOptions): string {
  const { sourceLang, targetLang, platform, glossary, outputMode } = options
  const parts: string[] = []

  parts.push(`源语言: ${LANGUAGE_NAMES[sourceLang]}`)
  parts.push(`目标语言: ${LANGUAGE_NAMES[targetLang]}`)

  if (platform && platform !== 'other') {
    parts.push(`平台: ${platform}`)
  }

  // 术语表
  const glossaryStr = glossary ? formatGlossaryForPrompt(glossary) : ''
  if (glossaryStr) {
    parts.push(glossaryStr)
  }

  // 输出模式
  if (outputMode === 'json') {
    parts.push('')
    parts.push('输出格式: JSON')
    parts.push('请按以下 JSON schema 输出:')
    parts.push(JSON.stringify({
      source_lang: '源语言代码',
      target_lang: '目标语言代码',
      translated_text: '翻译后的文本',
      warnings: ['警告列表，无警告则为空数组'],
      preserved_counts: {
        code_blocks: '代码块数量',
        inline_code: '行内代码数量',
        math: '数学公式数量',
        urls: 'URL数量',
        samples: '样例数量',
      },
    }, null, 2))
  }

  parts.push('')
  parts.push('请翻译以下内容:')
  parts.push(text)

  return parts.join('\n')
}

/**
 * 构造格式化专用 prompt（不翻译，只修正常量格式）
 */
export function buildFormatPrompt(text: string, platform?: Platform): { system: string; user: string } {
  const system = `你是竞赛题面格式化引擎。

## 任务
修正 Markdown 格式的竞赛题面，使其格式规范。

## 规则
1. 变量名和数学符号用 $...$ 包裹（如 $n$, $m$, $a_i$, $\\leq$, $\\geq$）
2. 数学表达式使用 LaTeX 格式
3. 行内变量：单个字母的变量、下标、上标都要用 $ 包裹
4. 独立公式块使用 $$...$$
5. 不修改代码块内容
6. 不修改样例输入输出数据
7. 保持原文含义不变
8. 保持章节结构（## 标题等）
9. 只输出格式化后的内容，不要解释
10. 不翻译任何文字，只修正格式
11. 数学公式中的 \$ 表示字面美元符号（如洛谷题面的 $\\$1$ 表示"$1"），格式化时保持 \$ 不变，不要误认为是 display math $$`

  const rules = getPlatformRules(platform)
  const systemFull = rules.length > 0
    ? system + '\n\n## 平台特殊规则\n' + rules.map(r => `- ${r}`).join('\n')
    : system

  return {
    system: systemFull,
    user: `请格式化以下竞赛题面 Markdown:\n\n${text}`,
  }
}
