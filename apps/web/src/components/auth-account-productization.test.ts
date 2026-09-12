import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

describe('account and authentication productization', () => {
  it('keeps account identity separate from organization real names', () => {
    const source = read('./profile/ProfileEditor.tsx')
    expect(source).toContain('用户名')
    expect(source).toContain('readOnly')
    expect(source).toContain('校园真实姓名由各学校身份资料独立管理')
    expect(source).not.toContain("handleChange('name'")
  })

  it('exposes session revocation and keeps the current device signed in', () => {
    const source = read('./profile/PasswordEditor.tsx')
    expect(source).toContain('/api/auth/sessions/revoke')
    expect(source).toContain('退出其他设备')
    expect(source).toContain('当前设备会继续保持登录')
  })

  it('resolves the organization identity from the current URL and prefers safe next after login', () => {
    const provider = read('./AuthProvider.tsx')
    const login = read('../app/login/LoginForm.tsx')
    expect(provider).toContain("pathname.match(/^\\/org\\/([^/]+)/)")
    expect(provider).toContain("apiClient.query<AuthUser>('/api/auth/me'")
    expect(login).toContain("nextPath || (isGlobalAdmin ? getRoleHome")
  })

  it('uses the full account notification view and displays its school source', () => {
    const source = read('../app/account/notifications/page.tsx')
    expect(source).toContain('view=account')
    expect(source).toContain('所有已加入学校')
    expect(source).toContain('来源学校：')
  })
})
