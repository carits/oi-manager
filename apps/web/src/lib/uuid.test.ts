import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClientUUID } from './uuid'

describe('createClientUUID', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses getRandomValues when randomUUID is unavailable on an HTTP page', () => {
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array) {
        bytes.forEach((_, index) => { bytes[index] = index })
        return bytes
      },
    })

    expect(createClientUUID()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })

  it('still returns a UUID-shaped id when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined)
    expect(createClientUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
