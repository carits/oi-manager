/**
 * validate.ts — 翻译后结构校验
 *
 * 9 项检查，确保格式未被损坏。
 * 校验失败时返回诊断信息，不静默输出损坏结果。
 */

import type { Placeholder, ValidationResult } from './types'
import { findResidualPlaceholders } from './restore'

/**
 * 比较原文和译文中某种模式的数量
 */
function countPattern(text: string, pattern: RegExp): number {
  return (text.match(pattern) || []).length
}

/**
 * 校验翻译结果的结构完整性
 *
 * @param original 原始文本（翻译前）
 * @param translated 翻译后的文本（已还原占位符）
 * @param placeholders 使用的占位符列表
 * @returns 校验结果
 */
export function validate(
  original: string,
  translated: string,
  placeholders: Placeholder[]
): ValidationResult {
  const errors: string[] = []

  // 1. 占位符全部还原（无残留）
  const residual = findResidualPlaceholders(translated)
  if (residual.length > 0) {
    errors.push(`占位符残留 ${residual.length} 个: ${residual.join(', ')}`)
  }

  // 2. Fenced code block 数量一致
  const origCodeBlocks = countPattern(original, /```\w*\n/g)
  const transCodeBlocks = countPattern(translated, /```\w*\n/g)
  if (origCodeBlocks !== transCodeBlocks) {
    errors.push(`代码块数量不一致: 原文 ${origCodeBlocks}, 译文 ${transCodeBlocks}`)
  }

  // 3. Inline code 数量一致
  const origInline = countPattern(original, /`[^`\n]+`/g)
  const transInline = countPattern(translated, /`[^`\n]+`/g)
  if (origInline !== transInline) {
    errors.push(`行内代码数量不一致: 原文 ${origInline}, 译文 ${transInline}`)
  }

  // 4. Display math 数量一致
  const origDisplayMath = countPattern(original, /\$\$/g)
  const transDisplayMath = countPattern(translated, /\$\$/g)
  if (origDisplayMath !== transDisplayMath) {
    errors.push(`块公式数量不一致: 原文 ${origDisplayMath}, 译文 ${transDisplayMath}`)
  }

  // 5. URL 数量一致
  const origUrls = countPattern(original, /https?:\/\/[^\s)\]>"']+/g)
  const transUrls = countPattern(translated, /https?:\/\/[^\s)\]>"']+/g)
  if (origUrls !== transUrls) {
    errors.push(`URL 数量不一致: 原文 ${origUrls}, 译文 ${transUrls}`)
  }

  // 6. YES/NO 等字面量未被翻译（独立出现次数不变）
  const literals = ['YES', 'NO', 'Alice', 'Bob', 'First', 'Second', 'TAK']
  for (const literal of literals) {
    const origCount = countPattern(original, new RegExp(`(?<![a-zA-Z_])${literal}(?![a-zA-Z_])`, 'g'))
    const transCount = countPattern(translated, new RegExp(`(?<![a-zA-Z_])${literal}(?![a-zA-Z_])`, 'g'))
    if (origCount > 0 && origCount !== transCount) {
      errors.push(`字面量 "${literal}" 数量不一致: 原文 ${origCount}, 译文 ${transCount}`)
    }
  }

  // 7. Markdown 标题层级不变（## 数量和位置）
  const origHeadings = original.match(/^#{1,6}\s/gm) || []
  const transHeadings = translated.match(/^#{1,6}\s/gm) || []
  if (origHeadings.length !== transHeadings.length) {
    errors.push(`标题层级数量不一致: 原文 ${origHeadings.length}, 译文 ${transHeadings.length}`)
  }

  // 8. 表格列数不变（| --- | 行中的 | 数量）
  const origTableRows = original.match(/^\|[\s\-:|]+\|$/gm) || []
  const transTableRows = translated.match(/^\|[\s\-:|]+\|$/gm) || []
  if (origTableRows.length !== transTableRows.length) {
    errors.push(`表格分隔行数量不一致: 原文 ${origTableRows.length}, 译文 ${transTableRows.length}`)
  }
  // 检查每行的列数
  for (let i = 0; i < Math.min(origTableRows.length, transTableRows.length); i++) {
    const origCols = (origTableRows[i].match(/\|/g) || []).length
    const transCols = (transTableRows[i].match(/\|/g) || []).length
    if (origCols !== transCols) {
      errors.push(`表格第 ${i + 1} 行列数不一致: 原文 ${origCols}, 译文 ${transCols}`)
    }
  }

  // 9. 占位符还原后数量校验
  // 已在第 1 步检查残留，这里检查占位符映射表完整性
  const uniqueIds = new Set(placeholders.map(p => p.id))
  if (uniqueIds.size !== placeholders.length) {
    errors.push(`占位符 ID 重复: ${placeholders.length} 个中有 ${placeholders.length - uniqueIds.size} 个重复`)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
