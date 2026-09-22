import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionManager } from '../src/lib/browser/session'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('browser session persistence', () => {
  it('stores persisted cookies with owner-only permissions', async () => {
    if (process.platform === 'win32') return

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-manager-session-'))
    roots.push(root)
    const sessionsDir = path.join(root, 'sessions')
    const manager = new SessionManager(sessionsDir)

    await manager.saveCookies('test-session', [{
      name: 'session',
      value: 'secret',
      domain: 'example.com',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    }])

    const dirMode = fs.statSync(sessionsDir).mode & 0o777
    const fileMode = fs.statSync(path.join(sessionsDir, 'test-session.json')).mode & 0o777

    expect(dirMode).toBe(0o700)
    expect(fileMode).toBe(0o600)
  })
})
