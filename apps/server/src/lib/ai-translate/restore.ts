/**
 * restore.ts — 占位符还原
 *
 * 将 __XXX_n__ 占位符精确替换回原文。
 * 要求字节级一致。
 */

import type { Placeholder } from './types'

export function restore(text: string, placeholders: Placeholder[]): string {
  let result = text

  // 按 ID 长度降序排列，避免短 ID 误匹配长 ID
  // 例如 __CODE_1__ 不应先于 __CODE_10__ 被替换
  const sorted = [...placeholders].sort((a, b) => b.id.length - a.id.length)

  for (const ph of sorted) {
    // 使用 split + join 代替 replaceAll，避免 ES2021 要求和 $ 特殊字符问题
    result = result.split(ph.id).join(ph.original)
  }

  return result
}

/**
 * 检查文本中是否还有残留的占位符
 *
 * @returns 残留的占位符 ID 列表（空数组表示全部还原成功）
 */
export function findResidualPlaceholders(text: string): string[] {
  const pattern = /__(?:CODE|INDENT_CODE|INLINE|MATH_BLOCK|MATH|SAMPLE_IN|SAMPLE_OUT|URL|FILE|HTML|LITERAL)_\d+__/g
  const matches = text.match(pattern)
  return matches ? [...new Set(matches)] : []
}

/**
 * 还原并校验
 *
 * @returns 还原后的文本 + 是否成功 + 残留列表
 */
export function restoreAndVerify(
  text: string,
  placeholders: Placeholder[]
): {
  text: string
  success: boolean
  residualIds: string[]
} {
  const restored = restore(text, placeholders)
  const residualIds = findResidualPlaceholders(restored)

  return {
    text: restored,
    success: residualIds.length === 0,
    residualIds,
  }
}
