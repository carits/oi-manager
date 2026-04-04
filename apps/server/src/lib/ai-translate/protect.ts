/**
 * protect.ts — 危险片段识别与占位符替换
 *
 * 处理优先级（先提取的不会被后续规则误匹配）：
 *  1. fenced code blocks  (```...```)
 *  2. sample I/O blocks    (样例输入/输出 + 代码块组合)
 *  3. display math         ($$...$$)
 *  4. inline math          ($...$)
 *  5. indented code blocks (4空格/Tab 开头)
 *  6. inline code          (`...`)
 *  7. URLs                 (http(s)://...)
 *  8. HTML tags            (<tag>...</tag>)
 *  9. judge literals       (YES/NO/Alice/Bob/First/Second)
 * 10. file paths           (xxx.in/.out/.cpp 等)
 */

import type { Placeholder, PlaceholderType, ProtectResult } from './types'

// ===== 计数器 =====

let counter = 0
function nextId(prefix: string): string {
  counter++
  return `__${prefix}_${counter}__`
}

/** 重置计数器（测试用） */
export function resetCounter(): void {
  counter = 0
}

// ===== 保护规则定义 =====

interface ProtectRule {
  type: PlaceholderType
  prefix: string
  pattern: RegExp
  /** 是否需要多行模式 */
  multiline?: boolean
  /** 提取匹配组索引（默认 0 = 整体匹配） */
  group?: number
}

/**
 * 按优先级排列的保护规则
 *
 * 每条规则的 pattern 匹配到的内容会被整体替换为占位符。
 * 先执行的规则优先级更高，已替换的 __XXX_n__ 不会被后续规则误匹配
 * （因为 __XXX_n__ 不包含任何触发后续规则的语法元素）。
 */
const RULES: ProtectRule[] = [
  // 1. Fenced code blocks: ```lang\n...\n``` 或 ~~~\n...\n~~~
  {
    type: 'fenced_code',
    prefix: 'CODE',
    pattern: /(^|\n)(```[\s\S]*?```|~~~[\s\S]*?~~~)/g,
  },

  // 2. Display math: $$...$$  （跨行也匹配）
  {
    type: 'math_display',
    prefix: 'MATH_BLOCK',
    pattern: /\$\$[\s\S]*?\$\$/g,
  },

  // 3. Inline math: $...$  （排除 $$ 和空 $）
  //    只匹配 $...$ 且内部不包含 $ 的行内公式
  {
    type: 'math_inline',
    prefix: 'MATH',
    pattern: /(?<!\$)\$(?!\$)([^\$\n]+?)(?<!\$)\$(?!\$)/g,
    group: 0,
  },

  // 4. Indented code blocks: 行首 4 空格或 Tab，连续 2 行以上
  //    注意：这要在 fenced code 被替换之后才执行
  {
    type: 'indented_code',
    prefix: 'INDENT_CODE',
    pattern: /(?:^|\n)((?:    |\t)[^\n]*\n){2,}/gm,
  },

  // 5. Inline code: `...`
  {
    type: 'inline_code',
    prefix: 'INLINE',
    pattern: /`([^`\n]+?)`/g,
  },

  // 6. URLs
  {
    type: 'url',
    prefix: 'URL',
    pattern: /https?:\/\/[^\s)\]>"']+/g,
  },

  // 7. HTML tags: <tag ...> 或 <tag ...>...</tag>
  {
    type: 'html_tag',
    prefix: 'HTML',
    pattern: /<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?\/?>/g,
  },

  // 8. Judge literals: 独立出现的特殊输出字面量
  {
    type: 'judge_literal',
    prefix: 'LITERAL',
    pattern: /(?<![a-zA-Z_])(?:YES|NO|Alice|Bob|First|Second|TAK|NIHIL|First|Second)(?![a-zA-Z_])/g,
  },

  // 9. File paths: xxx.in / xxx.out / xxx.cpp 等
  {
    type: 'file_path',
    prefix: 'FILE',
    pattern: /\b\w+\.(in|out|cpp|py|java|pas|txt|exe|sh|bat|dat)\b/gi,
  },
]

// ===== 主保护函数 =====

/**
 * 识别文本中的危险片段并替换为占位符
 *
 * @param text 原始 Markdown/HTML/纯文本
 * @returns 保护后的文本 + 占位符映射表 + 统计
 */
export function protect(text: string): ProtectResult {
  resetCounter()

  const placeholders: Placeholder[] = []
  const stats: Record<PlaceholderType, number> = {
    fenced_code: 0,
    indented_code: 0,
    inline_code: 0,
    math_display: 0,
    math_inline: 0,
    sample_input: 0,
    sample_output: 0,
    url: 0,
    file_path: 0,
    html_tag: 0,
    md_heading: 0,
    md_table_border: 0,
    judge_literal: 0,
  }

  let protectedText = text

  for (const rule of RULES) {
    // 重置 regex 的 lastIndex（避免全局正则在多次调用中状态残留）
    const regex = new RegExp(rule.pattern.source, rule.pattern.flags)

    protectedText = protectedText.replace(regex, (match: string, ...args: unknown[]) => {
      // 获取实际匹配内容
      const groupIdx = rule.group ?? 0
      const actualMatch = groupIdx > 0
        ? (args[groupIdx - 1] as string) ?? match
        : match

      // 跳过空匹配
      if (!actualMatch || actualMatch.trim().length === 0) {
        return match
      }

      const id = nextId(rule.prefix)
      placeholders.push({
        id,
        original: actualMatch,
        type: rule.type,
      })
      stats[rule.type]++

      // 替换时保留 match 中的非捕获组前缀（如换行符）
      if (groupIdx > 0 && actualMatch !== match) {
        // match 中包含前缀 + actualMatch，只替换 actualMatch 部分
        return match.replace(actualMatch, id)
      }
      return id
    })
  }

  return {
    protectedText,
    placeholders,
    stats,
  }
}

/**
 * 保护样例数据块
 *
 * 专门处理样例输入输出区域（Markdown 中常见格式）：
 * - **样例输入** / **输入样例** + 代码块
 * - **样例输出** / **输出样例** + 代码块
 *
 * 这个函数在通用 protect() 之前调用，确保样例区域整体被保护。
 */
export function protectSampleBlocks(text: string): {
  text: string
  placeholders: Placeholder[]
} {
  const placeholders: Placeholder[] = []

  // 匹配模式：**样例输入/输出** 标题 + 后面的代码块（含可能的说明文字）
  const samplePattern = /(\*\*(?:样例输入|输入样例|Sample\s*Input|样例输出|输出样例|Sample\s*Output)\*\*\s*\n[\s\S]*?```[\s\S]*?```)/gi

  const result = text.replace(samplePattern, (match) => {
    const isInput = /样例输入|输入样例|Sample\s*Input/i.test(match)
    const prefix = isInput ? 'SAMPLE_IN' : 'SAMPLE_OUT'
    const id = nextId(prefix)

    placeholders.push({
      id,
      original: match,
      type: isInput ? 'sample_input' : 'sample_output',
    })

    return id
  })

  return { text: result, placeholders }
}

/**
 * 完整保护流程（含样例块优先保护）
 */
export function protectFull(text: string): ProtectResult {
  // 先保护样例块（优先级最高）
  const { text: afterSamples, placeholders: samplePlaceholders } = protectSampleBlocks(text)

  // 再执行通用保护
  const general = protect(afterSamples)

  return {
    protectedText: general.protectedText,
    placeholders: [...samplePlaceholders, ...general.placeholders],
    stats: {
      ...general.stats,
      sample_input: samplePlaceholders.filter(p => p.type === 'sample_input').length,
      sample_output: samplePlaceholders.filter(p => p.type === 'sample_output').length,
    },
  }
}
