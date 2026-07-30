import { expect, test } from '@playwright/test'

const username = process.env.E2E_LIVE_USERNAME
const password = process.env.E2E_LIVE_PASSWORD
const role = process.env.E2E_LIVE_ROLE || 'teacher'

test.beforeAll(() => {
  if (!username || !password) {
    throw new Error('E2E_LIVE_USERNAME and E2E_LIVE_PASSWORD are required for the manual live suite')
  }
})

test('configured account can reach the live OJ binding service', async ({ page }) => {
  await page.goto(`/login?role=${role}`)
  await page.locator('input[name="username"]').fill(username!)
  await page.locator('input[name="password"]').fill(password!)
  await page.getByRole('button', { name: /登录/ }).click()
  await expect(page).not.toHaveURL(/\/login/)

  const response = await page.request.get('/api/platform-bindings')
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.success).toBe(true)
  expect(Array.isArray(body.data)).toBe(true)
})

test('judge endpoint requires authentication', async ({ page }) => {
  await page.goto('/login')
  const result = await page.evaluate(
    () =>
      new Promise<{ type: string; message: string }>((resolve, reject) => {
        const socket = new WebSocket(
          `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host.replace(/:\d+$/, ':3002')}/ws/judge`,
        )
        const timeout = window.setTimeout(() => reject(new Error('Judge endpoint did not respond')), 10_000)
        socket.addEventListener('open', () => {
          socket.send(JSON.stringify({ type: 'register', payload: { judgeId: 'live-probe', languages: [] } }))
        })
        socket.addEventListener('message', event => {
          const message = JSON.parse(String(event.data))
          if (message.type === 'error') {
            window.clearTimeout(timeout)
            resolve({ type: message.type, message: message.payload?.message || '' })
            socket.close()
          }
        })
      }),
  )

  expect(result.type).toBe('error')
  expect(result.message).toMatch(/authenticated|token/i)
})
