import { describe, expect, it } from 'vitest'
import {
  getAdapter,
  getSupportedPlatforms,
  isKnownPlatform,
  isPlatformSupported,
} from '../src/oj-adapters'

describe('canonical OJ adapter registry', () => {
  it('uses shared aliases at the server boundary', () => {
    expect(isKnownPlatform('oj.uz')).toBe(true)
    expect(isKnownPlatform('LOJ')).toBe(true)
    expect(isPlatformSupported('loj')).toBe(true)
    expect(getAdapter('loj').platform).toBe('libreoj')
  })

  it('exposes unique canonical adapter keys and honest support state', () => {
    const platforms = getSupportedPlatforms()
    expect(new Set(platforms.map(item => item.platform)).size).toBe(platforms.length)
    expect(platforms.find(item => item.platform === 'ojuz')).toMatchObject({ supported: true, name: 'oj.uz' })
    expect(platforms.find(item => item.platform === 'uva')).toMatchObject({ supported: false, name: 'UVA' })
  })
})
