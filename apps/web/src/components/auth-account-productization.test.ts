import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

describe('account and authentication productization', () => {
  it('keeps account identity separate from organization real names', () => {
    const source = read('../features/auth/ui/ProfileEditor.tsx')
    expect(source).toContain('用户名')
    expect(source).toContain('readOnly')
    expect(source).toContain('校园真实姓名由各学校身份资料独立管理')
    expect(source).not.toContain("handleChange('name'")
  })

  it('exposes session revocation and keeps the current device signed in', () => {
    const source = read('../features/auth/ui/PasswordEditor.tsx')
    const api = read('../features/auth/api/authApi.ts')
    expect(source).toContain('revokeOtherSessions()')
    expect(api).toContain('/api/auth/sessions/revoke')
    expect(source).toContain('退出其他设备')
    expect(source).toContain('当前设备会继续保持登录')
  })

  it('resolves the organization identity from the current URL and prefers safe next after login', () => {
    const provider = read('../features/auth/model/AuthProvider.tsx')
    const api = read('../features/auth/api/authApi.ts')
    const login = read('../features/auth/ui/LoginForm.tsx')
    expect(provider).toContain("pathname.match(/^\\/org\\/([^/]+)/)")
    expect(provider).toContain('loadCurrentAccount(organizationId)')
    expect(api).toContain('queryContract(AuthContracts.me')
    expect(api).toContain('mutateContract(AuthContracts.login')
    expect(login).toContain("nextPath || (isGlobalAdmin ? getRoleHome")
  })

  it('exposes authentication only through the feature public boundary', () => {
    const index = read('../features/auth/index.ts')
    const profileRoute = read('../app/account/profile/page.tsx')
    expect(index).toContain("from './model/AuthProvider'")
    expect(index).toContain("from './api/authApi'")
    expect(profileRoute).toContain("from '@/features/auth'")
  })

  it('uses the full account notification view and displays its school source', () => {
    const route = read('../app/account/notifications/page.tsx')
    const api = read('../features/notification/api/notificationApi.ts')
    const source = read('../features/notification/ui/NotificationCenterPage.tsx')
    expect(route).toContain("from '@/features/notification'")
    expect(api).toContain("view: 'account'")
    expect(source).toContain('所有已加入学校')
    expect(source).toContain('来源学校：')
  })
})
