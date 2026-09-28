import { expect, test, type Route } from '@playwright/test'
import { accounts } from '../fixtures/auth'

const organizationBase = '/org/org_school-default'
const directoryRoute = /\/api\/workspaces(?:\?|$)/

test.describe('Shared workspace directory @smoke @compact', () => {
  test('selecting the current workspace is a no-op and reopening reuses the account directory', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    let documents = 0
    let reads = 0
    page.on('request', request => {
      if (request.resourceType() === 'document') documents += 1
      if (new URL(request.url()).pathname === '/api/workspaces') reads += 1
    })
    await page.goto(`${organizationBase}/overview`)
    const trigger = page.getByRole('button', { name: /切换工作区，当前/ })
    await trigger.click()
    const directory = page.getByRole('region', { name: '切换工作区', exact: true })
    await directory.getByRole('button', { name: /E2E School.*教师/ }).click()
    await expect(directory).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(page).toHaveURL(`${organizationBase}/overview`)
    expect(documents).toBe(1)
    await trigger.click()
    await expect(directory.getByRole('button', { name: /E2E School.*教师/ })).toBeVisible()
    expect(reads).toBe(1)
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await context.close()
  })

  test('directory errors retain the current workspace and support a real retry', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    const fail = (route: Route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: '目录暂不可用' }) })
    await page.route(directoryRoute, fail)
    await page.goto(`${organizationBase}/overview`)
    await page.getByRole('button', { name: /切换工作区，当前/ }).click()
    const directory = page.getByRole('region', { name: '切换工作区', exact: true })
    await expect(directory.getByRole('alert')).toContainText('工作区列表加载失败，当前身份不会改变')
    await expect(page).toHaveURL(`${organizationBase}/overview`)
    await expect(page.getByRole('navigation', { name: '教师主导航' })).toBeVisible()
    await page.unroute(directoryRoute, fail)
    await directory.getByRole('button', { name: '重新加载', exact: true }).click()
    await expect(directory.getByRole('button', { name: /E2E School.*教师/ })).toBeVisible()
    await expect(directory.getByRole('alert')).toHaveCount(0)
    await context.close()
  })

  test('existing hard workspace navigation still resolves server-authorized school and personal contexts', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    await page.goto(`${organizationBase}/overview`)
    await page.getByRole('button', { name: /切换工作区，当前/ }).click()
    await page.getByRole('region', { name: '切换工作区', exact: true }).getByRole('button', { name: /个人空间.*teacher2/ }).click()
    await expect(page).toHaveURL('/personal')
    await expect(page.getByRole('navigation', { name: '个人主导航' })).toBeVisible()
    await expect(page.getByRole('button', { name: /切换工作区，当前个人空间/ })).toBeVisible()
    await page.getByRole('button', { name: /切换工作区，当前/ }).click()
    await page.getByRole('region', { name: '切换工作区', exact: true }).getByRole('button', { name: /E2E School.*教师/ }).click()
    await expect(page).toHaveURL(`${organizationBase}/overview`)
    await expect(page.getByRole('navigation', { name: '教师主导航' })).toBeVisible()
    await expect(page.getByRole('button', { name: /切换工作区，当前E2E School/ })).toBeVisible()
    await context.close()
  })
})
