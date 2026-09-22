import fs from 'node:fs'
import path from 'node:path'
import { expect, test as setup } from '@playwright/test'
import { accounts, type AuthRole } from '../fixtures/auth'

const authRoles = Object.keys(accounts) as AuthRole[]

for (const role of authRoles) {
  setup(`authenticate ${role}`, async ({ request }) => {
    const account = accounts[role]
    const response = await request.post('/api/auth/login', {
      data: {
        username: account.username,
        password: account.password,
        workspaceMode: account.workspaceMode,
      },
    })

    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)

    fs.mkdirSync(path.dirname(account.storageState), { recursive: true })
    await request.storageState({ path: account.storageState })
  })
}
