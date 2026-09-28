import { describe, expect, it } from 'vitest'
import { readEditorBindings, UNREADABLE_BINDINGS_MESSAGE } from './problemEditorBindings'

describe('problem editor binding read boundary', () => {
  it('treats null and an explicit empty array as readable empty bindings', () => {
    expect(readEditorBindings(null)).toEqual({ ok: true, bindings: [] })
    expect(readEditorBindings('[]')).toEqual({ ok: true, bindings: [] })
  })

  it('normalizes registered platform aliases and preserves problem number and URL text', () => {
    expect(readEditorBindings(JSON.stringify([
      { platform: ' 洛谷 ', problemId: ' P1001 ', url: ' https://example.test/problem/P1001 ' },
    ]))).toEqual({
      ok: true,
      bindings: [{ platform: 'luogu', problemId: 'P1001', url: ' https://example.test/problem/P1001 ' }],
    })
  })

  it.each([
    ['not json'],
    [JSON.stringify({ platform: 'luogu', problemId: 'P1001' })],
    [JSON.stringify([{ platform: 'unknown-platform', problemId: 'P1001' }])],
    [JSON.stringify([{ platform: 'luogu', problemId: '' }])],
    [JSON.stringify([{ platform: 'luogu', problemId: 'P1001', url: 1 }])],
    [JSON.stringify([{ platform: 'luogu', problemId: 'P1001', extra: true }])],
    [JSON.stringify(Array.from({ length: 4 }, (_, index) => ({ platform: 'luogu', problemId: `P${index}` })))],
  ])('keeps malformed historical data unreadable instead of manufacturing a destructive empty list', raw => {
    expect(readEditorBindings(raw)).toEqual({ ok: false, message: UNREADABLE_BINDINGS_MESSAGE })
  })
})
