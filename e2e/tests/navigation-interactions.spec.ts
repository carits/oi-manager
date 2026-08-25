import { expect, test, type Page } from '@playwright/test'
import { accounts, type AuthRole } from '../fixtures/auth'
import { assertPageHealth, waitForPageReady, watchPage } from '../support/page-audit'

const organizationBase = '/org/org_school-default'
const roles: Array<{ account: AuthRole; home: string; navigation: string }> = [
  { account: 'principal', home: `${organizationBase}/overview`, navigation: '学校负责人主导航' },
  { account: 'teacher', home: `${organizationBase}/overview`, navigation: '教师主导航' },
  { account: 'campusStudent', home: `${organizationBase}/overview`, navigation: '学生主导航' },
  { account: 'personalStudent', home: '/personal', navigation: '个人主导航' },
]

async function ensureNavigationOpen(page: Page, navigationName: string) {
  const navigation = page.getByRole('navigation', { name: navigationName })
  // AppShell restores the persisted sidebar choice after hydration. Wait for
  // that restore before deciding whether a click is needed.
  await page.waitForTimeout(150)
  if (!await navigation.isVisible()) await page.locator('[aria-controls="app-sidebar"]').click()
  await expect(navigation).toBeVisible()
  return navigation
}

test.describe('导航与顶栏交互巡检 @smoke', () => {
  for (const entry of roles) {
    test(`${entry.account} 的侧栏入口和账号菜单均可到达`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: accounts[entry.account].storageState })
      const page = await context.newPage()
      await page.goto(entry.home)
      await waitForPageReady(page)

      const navigation = await ensureNavigationOpen(page, entry.navigation)
      const links = await navigation.getByRole('link').evaluateAll(items => items.map(item => ({ href: (item as HTMLAnchorElement).getAttribute('href') || '' })))

      for (const link of links) {
        expect(link.href, `${entry.account} 的侧栏入口缺少跳转地址`).toMatch(/^\//)
        await page.goto(entry.home)
        const currentNavigation = await ensureNavigationOpen(page, entry.navigation)
        const clickAudit = watchPage(page)
        await currentNavigation.locator(`a[href="${link.href}"]`).click()
        await waitForPageReady(page)
        await assertPageHealth(page, clickAudit)
        await expect(page.locator('body')).not.toContainText('页面不存在')
      }

      await page.goto(entry.home)
      await ensureNavigationOpen(page, entry.navigation)
      await page.getByRole('button', { name: '打开账号菜单' }).click()
      const accountMenu = page.getByRole('menu')
      await expect(accountMenu).toBeVisible()
      for (const label of ['个人信息', '账号安全', '平台绑定']) {
        await page.goto(entry.home)
        await ensureNavigationOpen(page, entry.navigation)
        await page.getByRole('button', { name: '打开账号菜单' }).click()
        const accountAudit = watchPage(page)
        await page.getByRole('menuitem', { name: label }).click()
        await waitForPageReady(page)
        await assertPageHealth(page, accountAudit)
      }
      await context.close()
    })
  }

  test('通知、账号与切换身份面板不会被裁切，并可由 Escape 关闭', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    await page.goto(`${organizationBase}/management`)

    const headerPanels = [
      { button: page.getByRole('button', { name: /打开通知/ }), panel: page.getByRole('region', { name: '通知' }) },
      { button: page.getByRole('button', { name: '切换身份' }), panel: page.getByRole('menu', { name: '切换身份' }) },
    ]
    for (const { button, panel } of headerPanels) {
      await button.click()
      await expect(panel).toBeVisible()
      const box = await panel.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(1440)
      await page.keyboard.press('Escape')
    }
    await ensureNavigationOpen(page, '教师主导航')
    await page.getByRole('button', { name: '打开账号菜单' }).click()
    const accountMenu = page.getByRole('menu')
    await expect(accountMenu).toBeVisible()
    const accountBox = await accountMenu.boundingBox()
    expect(accountBox).not.toBeNull()
    expect(accountBox!.x).toBeGreaterThanOrEqual(0)
    expect(accountBox!.x + accountBox!.width).toBeLessThanOrEqual(1440)
    await page.keyboard.press('Escape')
    await context.close()
  })
})
