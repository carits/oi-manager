import { describe, expect, it } from 'vitest'
import { isPrivateRemoteHost, validateRemoteUrl } from '../src/routes/oj-fetcher'

describe('OJ remote download safety', () => {
  it('blocks loopback, link-local and private addresses', () => {
    for (const host of ['127.0.0.1', '10.0.0.8', '172.16.0.1', '192.168.1.8', '169.254.169.254', 'localhost', '::1']) {
      expect(isPrivateRemoteHost(host)).toBe(true)
    }
  })

  it('accepts public HTTP(S) URLs and rejects unsupported protocols', () => {
    expect(validateRemoteUrl('https://luogu.com.cn/problem/P1000').hostname).toBe('luogu.com.cn')
    expect(() => validateRemoteUrl('file:///etc/passwd')).toThrow()
    expect(() => validateRemoteUrl('http://127.0.0.1:8080/admin')).toThrow()
  })
})
