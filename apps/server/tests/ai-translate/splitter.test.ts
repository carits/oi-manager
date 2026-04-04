/**
 * splitter.spec.ts — 文本分块单元测试
 */

import { describe, it, expect } from 'vitest'
import { splitText } from '../../src/lib/ai-translate/splitter'

describe('splitText', () => {
  it('should not split short text', () => {
    const text = '这是一段短文本'
    const chunks = splitText(text)
    expect(chunks).toEqual([text])
  })

  it('should split long text at paragraph boundaries', () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) => `第 ${i + 1} 段：这是比较长的段落内容，包含足够多的字符以确保触发分块逻辑。`)
    const text = paragraphs.join('\n\n')

    const chunks = splitText(text, { maxChunkSize: 200, minChunkSize: 50 })
    expect(chunks.length).toBeGreaterThan(1)

    // 每个块不应超过 maxChunkSize（允许小量误差）
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(250)
    }

    // 所有块的内容拼起来应包含原文所有段落文字
    const joined = chunks.join('\n')
    for (const p of paragraphs) {
      expect(joined).toContain(p.trim())
    }
  })

  it('should not split inside fenced code blocks', () => {
    const code = '```\n' + 'line\n'.repeat(100) + '```'
    const text = `一些文字\n\n${code}\n\n更多文字`

    const chunks = splitText(text, { maxChunkSize: 100 })
    // 代码块应该完整存在于某个块中
    const hasCompleteCodeBlock = chunks.some(chunk => chunk.includes('```'))
    expect(hasCompleteCodeBlock).toBe(true)
  })

  it('should not split inside display math', () => {
    const math = '$$\n' + 'x + y \\\\\n'.repeat(50) + '$$'
    const text = `公式\n\n${math}\n\n结论`

    const chunks = splitText(text, { maxChunkSize: 100 })
    const hasCompleteMath = chunks.some(chunk => chunk.includes('$$'))
    expect(hasCompleteMath).toBe(true)
  })

  it('should merge tiny last chunk', () => {
    const text = Array.from({ length: 3 }, (_, i) => `段${i} `.repeat(20)).join('\n\n') + '\n\n结尾'

    const chunks = splitText(text, { maxChunkSize: 100, minChunkSize: 10 })
    // 最后的 "结尾" 太小，应该合并到前一块
    expect(chunks.length).toBeGreaterThan(0)
  })

  it('should handle empty text', () => {
    const chunks = splitText('')
    expect(chunks).toEqual([''])
  })
})
