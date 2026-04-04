/**
 * protect.spec.ts — 保护与还原单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { protect, protectFull, protectSampleBlocks, resetCounter } from '../../src/lib/ai-translate/protect'
import { restore, restoreAndVerify, findResidualPlaceholders } from '../../src/lib/ai-translate/restore'

describe('protect + restore', () => {
  beforeEach(() => {
    resetCounter()
  })

  // ===== Fenced Code Blocks =====

  describe('fenced code blocks', () => {
    it('should protect fenced code blocks', () => {
      const input = '一些文字\n```cpp\nint main() { return 0; }\n```\n更多文字'
      const { protectedText, placeholders } = protect(input)

      expect(placeholders.length).toBe(1)
      expect(placeholders[0].type).toBe('fenced_code')
      expect(protectedText).not.toContain('int main()')
      expect(protectedText).toContain('__CODE_')

      // 还原
      const restored = restore(protectedText, placeholders)
      expect(restored).toBe(input)
    })

    it('should protect multiple fenced code blocks', () => {
      const input = '```\ncode1\n```\ntext\n```\ncode2\n```'
      const { protectedText, placeholders } = protect(input)

      expect(placeholders.length).toBe(2)
      const restored = restore(protectedText, placeholders)
      expect(restored).toBe(input)
    })

    it('should preserve code block language tag', () => {
      const input = '```python\nprint("hello")\n```'
      const { placeholders } = protect(input)

      expect(placeholders[0].original).toContain('```python')
      expect(placeholders[0].original).toContain('print("hello")')
    })
  })

  // ===== Display Math =====

  describe('display math', () => {
    it('should protect $$...$$ blocks', () => {
      const input = '公式：\n$$\nx^2 + y^2 = z^2\n$$\n结束'
      const { protectedText, placeholders } = protect(input)

      expect(placeholders.some(p => p.type === 'math_display')).toBe(true)
      expect(protectedText).not.toContain('x^2')

      const restored = restore(protectedText, placeholders)
      expect(restored).toBe(input)
    })

    it('should protect inline $$...$$', () => {
      const input = '计算 $E = mc^2$ 和 $$\\sum_{i=1}^{n} a_i$$ 结果'
      const { placeholders } = protect(input)

      const displayMath = placeholders.filter(p => p.type === 'math_display')
      expect(displayMath.length).toBe(1)
      expect(displayMath[0].original).toContain('\\sum')
    })
  })

  // ===== Inline Math =====

  describe('inline math', () => {
    it('should protect $...$ inline math', () => {
      const input = '变量 $n$ 和 $m$ 的值'
      const { protectedText, placeholders } = protect(input)

      const inlineMath = placeholders.filter(p => p.type === 'math_inline')
      expect(inlineMath.length).toBe(2)

      const restored = restore(protectedText, placeholders)
      expect(restored).toBe(input)
    })

    it('should not treat $$ as inline math', () => {
      const input = '公式 $$x^2$$ 结束'
      const { placeholders } = protect(input)

      // $$ 应该被识别为 display math，不是 inline math
      const inlineMath = placeholders.filter(p => p.type === 'math_inline')
      const displayMath = placeholders.filter(p => p.type === 'math_display')
      expect(displayMath.length).toBe(1)
      expect(inlineMath.length).toBe(0)
    })
  })

  // ===== Inline Code =====

  describe('inline code', () => {
    it('should protect inline code', () => {
      const input = '使用 `std::sort` 排序'
      const { protectedText, placeholders } = protect(input)

      const inlineCode = placeholders.filter(p => p.type === 'inline_code')
      expect(inlineCode.length).toBe(1)
      expect(inlineCode[0].original).toBe('`std::sort`')

      const restored = restore(protectedText, placeholders)
      expect(restored).toBe(input)
    })
  })

  // ===== URLs =====

  describe('URLs', () => {
    it('should protect URLs', () => {
      const input = '访问 https://example.com/problem/123 查看题目'
      const { protectedText, placeholders } = protect(input)

      const urls = placeholders.filter(p => p.type === 'url')
      expect(urls.length).toBe(1)
      expect(urls[0].original).toBe('https://example.com/problem/123')

      const restored = restore(protectedText, placeholders)
      expect(restored).toBe(input)
    })
  })

  // ===== HTML Tags =====

  describe('HTML tags', () => {
    it('should protect HTML tags', () => {
      const input = '<div class="alert">警告</div>'
      const { protectedText, placeholders } = protect(input)

      const htmlTags = placeholders.filter(p => p.type === 'html_tag')
      expect(htmlTags.length).toBe(2) // <div> and </div>

      const restored = restore(protectedText, placeholders)
      expect(restored).toBe(input)
    })
  })

  // ===== Judge Literals =====

  describe('judge literals', () => {
    it('should protect YES/NO literals', () => {
      const input = '如果满足条件输出 YES，否则输出 NO'
      const { placeholders } = protect(input)

      const literals = placeholders.filter(p => p.type === 'judge_literal')
      expect(literals.length).toBe(2)
    })

    it('should protect Alice/Bob', () => {
      const input = 'Alice 和 Bob 玩游戏'
      const { placeholders } = protect(input)

      const literals = placeholders.filter(p => p.type === 'judge_literal')
      expect(literals.length).toBe(2)
    })

    it('should not match inside words', () => {
      const input = '他的 NOtice 被忽略了'
      const { placeholders } = protect(input)

      const literals = placeholders.filter(p => p.type === 'judge_literal')
      // NO in NOtice should not be matched as it's part of a word
      expect(literals.length).toBe(0)
    })
  })

  // ===== File Paths =====

  describe('file paths', () => {
    it('should protect .in/.out files', () => {
      const input = '从 sort.in 读取，写入 sort.out'
      const { protectedText, placeholders } = protect(input)

      const files = placeholders.filter(p => p.type === 'file_path')
      expect(files.length).toBe(2)

      const restored = restore(protectedText, placeholders)
      expect(restored).toContain('sort.in')
      expect(restored).toContain('sort.out')
    })
  })

  // ===== Sample Blocks =====

  describe('sample blocks', () => {
    it('should protect sample input/output blocks', () => {
      const input = `## 样例

**样例输入**
\`\`\`
3 5
1 2 3
\`\`\`

**样例输出**
\`\`\`
6
\`\`\``

      const { text, placeholders } = protectSampleBlocks(input)
      expect(placeholders.length).toBe(2)

      const sampleIn = placeholders.filter(p => p.type === 'sample_input')
      const sampleOut = placeholders.filter(p => p.type === 'sample_output')
      expect(sampleIn.length).toBe(1)
      expect(sampleOut.length).toBe(1)
    })
  })

  // ===== Restore =====

  describe('restore', () => {
    it('should restore all placeholders exactly', () => {
      const input = '文字 `code` $n$ ```\ncode\n``` https://example.com'
      const { protectedText, placeholders } = protect(input)
      const restored = restore(protectedText, placeholders)
      expect(restored).toBe(input)
    })

    it('should detect residual placeholders', () => {
      const text = 'some __CODE_1__ residual __MATH_2__'
      const residuals = findResidualPlaceholders(text)
      expect(residuals).toContain('__CODE_1__')
      expect(residuals).toContain('__MATH_2__')
    })

    it('restoreAndVerify should report success', () => {
      const input = 'text `code` more'
      const { protectedText, placeholders } = protect(input)
      const result = restoreAndVerify(protectedText, placeholders)

      expect(result.success).toBe(true)
      expect(result.residualIds).toEqual([])
      expect(result.text).toBe(input)
    })
  })

  // ===== Complex Cases =====

  describe('complex cases', () => {
    it('should handle mixed content', () => {
      const input = `## 题目描述

给定 $n$ 个整数 $a_1, a_2, \\ldots, a_n$，求它们的和。

$$
S = \\sum_{i=1}^{n} a_i
$$

## 输入格式

第一行一个整数 $n$。

\`\`\`cpp
#include <iostream>
int main() {
    int n;
    std::cin >> n;
    return 0;
}
\`\`\`

如果 $n > 0$，输出 YES，否则输出 NO。

详见 https://example.com/problem`

      const { protectedText, placeholders } = protectFull(input)
      const restored = restore(protectedText, placeholders)
      expect(restored).toBe(input)
    })
  })
})
