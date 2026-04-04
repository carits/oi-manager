/**
 * validate.spec.ts — 结构校验单元测试
 */

import { describe, it, expect } from 'vitest'
import { validate } from '../../src/lib/ai-translate/validate'
import type { Placeholder } from '../../src/lib/ai-translate/types'

describe('validate', () => {
  const makePlaceholders = (count: number, prefix = 'CODE'): Placeholder[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `__${prefix}_${i + 1}__`,
      original: `original_${i}`,
      type: 'fenced_code' as const,
    }))
  }

  it('should pass for identical text', () => {
    const text = '## Hello\n\nSome text `code` $x$ ```\ncode\n```'
    const result = validate(text, text, [])
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('should pass when only natural language changes', () => {
    const original = '## Description\n\nGiven $n$ integers, find the sum.'
    const translated = '## 描述\n\n给定 $n$ 个整数，求它们的和。'
    const result = validate(original, translated, [])
    expect(result.valid).toBe(true)
  })

  it('should fail when code block count changes', () => {
    const original = 'text\n```\ncode\n```\nmore'
    const translated = 'translated text\nmore (missing code block)'
    const result = validate(original, translated, [])
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('代码块'))).toBe(true)
  })

  it('should fail when inline code count changes', () => {
    const original = 'use `sort` function'
    const translated = '使用排序函数' // missing backticks
    const result = validate(original, translated, [])
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('行内代码'))).toBe(true)
  })

  it('should fail when display math count changes', () => {
    const original = '$$x^2 + y^2$$'
    const translated = '公式内容' // missing $$
    const result = validate(original, translated, [])
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('块公式'))).toBe(true)
  })

  it('should fail when URL count changes', () => {
    const original = 'visit https://example.com for details'
    const translated = '访问 网址 了解详情' // URL removed
    const result = validate(original, translated, [])
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('URL'))).toBe(true)
  })

  it('should fail when YES/NO count changes', () => {
    const original = 'output YES or NO'
    const translated = '输出 是 或 否' // YES/NO removed
    const result = validate(original, translated, [])
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('YES') || e.includes('NO'))).toBe(true)
  })

  it('should pass when YES/NO preserved', () => {
    const original = 'output YES or NO'
    const translated = '输出 YES 或 NO'
    const result = validate(original, translated, [])
    expect(result.valid).toBe(true)
  })

  it('should fail when heading count changes', () => {
    const original = '## Title\n### Subtitle'
    const translated = '## 标题'  // missing one heading
    const result = validate(original, translated, [])
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('标题'))).toBe(true)
  })

  it('should pass when headings preserved', () => {
    const original = '## Description\n### Input'
    const translated = '## 描述\n### 输入'
    const result = validate(original, translated, [])
    expect(result.valid).toBe(true)
  })

  it('should fail when table column count changes', () => {
    const original = '| A | B |\n| --- | --- |'
    const translated = '| 甲 |\n| --- |'
    const result = validate(original, translated, [])
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('表格'))).toBe(true)
  })

  it('should pass when table structure preserved', () => {
    const original = '| A | B |\n| --- | --- |\n| 1 | 2 |'
    const translated = '| 甲 | 乙 |\n| --- | --- |\n| 一 | 二 |'
    const result = validate(original, translated, [])
    expect(result.valid).toBe(true)
  })

  it('should detect duplicate placeholder IDs', () => {
    const placeholders: Placeholder[] = [
      { id: '__CODE_1__', original: 'a', type: 'fenced_code' },
      { id: '__CODE_1__', original: 'b', type: 'fenced_code' },
    ]
    const result = validate('text', 'text', placeholders)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('重复'))).toBe(true)
  })
})
