/**
 * glossary.spec.ts — 术语表单元测试
 */

import { describe, it, expect } from 'vitest'
import { getGlossary, getPlatformRules, formatGlossaryForPrompt } from '../../src/lib/ai-translate/glossary'

describe('glossary', () => {
  describe('getGlossary', () => {
    it('should return zh→en defaults for zh source', () => {
      const glossary = getGlossary('zh', 'en')
      expect(glossary['子序列']).toBe('subsequence')
      expect(glossary['排列']).toBe('permutation')
      expect(glossary['字典序']).toBe('lexicographical order')
    })

    it('should return en→zh defaults for en source', () => {
      const glossary = getGlossary('en', 'zh')
      expect(glossary['subsequence']).toBe('子序列')
      expect(glossary['permutation']).toBe('排列')
    })

    it('should merge user glossary with defaults', () => {
      const glossary = getGlossary('zh', 'en', { '自定义术语': 'custom term' })
      expect(glossary['自定义术语']).toBe('custom term')
      // 默认术语仍然存在
      expect(glossary['子序列']).toBe('subsequence')
    })

    it('user glossary should override defaults', () => {
      const glossary = getGlossary('zh', 'en', { '子序列': 'my custom subsequence' })
      expect(glossary['子序列']).toBe('my custom subsequence')
    })
  })

  describe('getPlatformRules', () => {
    it('should return rules for codeforces', () => {
      const rules = getPlatformRules('codeforces')
      expect(rules.length).toBeGreaterThan(0)
      expect(rules[0]).toContain('YES/NO')
    })

    it('should return rules for atcoder', () => {
      const rules = getPlatformRules('atcoder')
      expect(rules.some(r => r.includes('Takahashi'))).toBe(true)
    })

    it('should return rules for usaco', () => {
      const rules = getPlatformRules('usaco')
      expect(rules.some(r => r.includes('.in'))).toBe(true)
    })

    it('should return empty for other', () => {
      const rules = getPlatformRules('other')
      expect(rules).toEqual([])
    })

    it('should return empty for undefined', () => {
      const rules = getPlatformRules(undefined as any)
      expect(rules).toEqual([])
    })
  })

  describe('formatGlossaryForPrompt', () => {
    it('should format glossary as bullet list', () => {
      const formatted = formatGlossaryForPrompt({ '子序列': 'subsequence' })
      expect(formatted).toContain('子序列')
      expect(formatted).toContain('subsequence')
      expect(formatted).toContain('→')
    })

    it('should return empty string for empty glossary', () => {
      const formatted = formatGlossaryForPrompt({})
      expect(formatted).toBe('')
    })
  })
})
