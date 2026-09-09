import { describe, expect, it } from 'vitest'
import { codeFingerprint, compareSolutionContent, markdownFingerprint, similarityRisk } from '../src/modules/solution/solution-similarity'

describe('solution similarity fingerprints', () => {
  it('normalizes formatting while retaining content differences', () => {
    const same = compareSolutionContent(
      { contentMarkdown: '# 解法\n使用 双指针 扫描 数组 并 维护 区间 答案。' },
      { contentMarkdown: '## 解法\n\n使用双指针扫描数组，并维护区间答案。' },
    )
    const different = compareSolutionContent(
      { contentMarkdown: '使用双指针扫描数组并维护区间答案。' },
      { contentMarkdown: '使用线段树维护区间最值，离线处理所有询问。' },
    )
    expect(same.textSimilarityBasisPoints).toBeGreaterThan(different.textSimilarityBasisPoints)
  })

  it('normalizes identifier renaming and literals in reference code', () => {
    const first = codeFingerprint('int main(){ int answer = 1; return answer; }')
    const second = codeFingerprint('int main(){ int result = 42; return result; }')
    expect(first).toEqual(second)
  })

  it('uses explicit stable risk thresholds', () => {
    expect(similarityRisk(8499)).toBe('MEDIUM')
    expect(similarityRisk(8500)).toBe('HIGH')
    expect(similarityRisk(6499)).toBe('LOW')
  })

  it('never includes fenced code in the prose fingerprint', () => {
    expect(markdownFingerprint('说明文字\n```cpp\nsecret copied code\n```'))
      .toEqual(markdownFingerprint('说明文字'))
  })
})
