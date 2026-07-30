import fs from 'node:fs'
import path from 'node:path'
import { expect, test as setup } from '@playwright/test'
import { accounts, type AuthRole } from '../fixtures/auth'

const authRoles = Object.keys(accounts) as AuthRole[]

for (const role of authRoles) {
  setup(`authenticate ${role}`, async ({ request, baseURL }) => {
    const account = accounts[role]
    const response = await request.post('/api/auth/login', {
      data: {
        username: account.username,
        password: account.password,
        role: account.loginRole,
        mode: account.mode,
      },
    })

    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)

    const data = body.data as {
      token: string
      role: string
      userId: string
      schoolId?: string
      studentMode?: string
    }
    const origin = new URL(baseURL || 'http://127.0.0.1:3100').origin
    const localStorage = [
      { name: 'token', value: data.token },
      { name: 'role', value: data.role },
      { name: 'userId', value: data.userId },
    ]
    if (data.schoolId) localStorage.push({ name: 'schoolId', value: data.schoolId })
    if (data.studentMode) {
      localStorage.push({ name: 'studentMode', value: data.studentMode })
      localStorage.push({ name: 'lastStudentMode', value: data.studentMode })
    }

    fs.mkdirSync(path.dirname(account.storageState), { recursive: true })
    fs.writeFileSync(
      account.storageState,
      `${JSON.stringify({ cookies: [], origins: [{ origin, localStorage }] }, null, 2)}\n`,
      'utf8',
    )
  })
}
