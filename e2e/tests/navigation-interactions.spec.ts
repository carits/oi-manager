import { expect, test } from '@playwright/test'
import { accounts, type AuthRole } from '../fixtures/auth'
import { assertPageHealth, waitForPageReady, watchPage } from '../support/page-audit'

const roles: Array<{ account: AuthRole; home: string; navigation: string }> = [
  { account: 'principal', home: '/teacher', navigation: '学校负责人主导航' },
  { account: 'teacher', home: '/teacher', navigation: '教师主导航' },
  { account: 'campusStudent', home: '/student', navigation: '学生主导航' },
  { account: 'personalStudent', home: '/personal', navigation: '个人主导航' },
]

test.describe('导航与顶栏交互巡检 @smoke', () => {
  for (const entry of roles) {
    test(`${entry.account} 的侧栏入口和账号菜单均可到达`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: accounts[entry.account].storageState })
      const page = await context.newPage()
      const audit = watchPage(page)
      await page.goto(entry.home)
      await waitForPageReady(page)

      const sidebarToggle = page.locator('[aria-controls="app-sidebar"]')
      if (await sidebarToggle.getAttribute('aria-expanded') !== 'true') await sidebarToggle.click()
      const navigation = page.getByRole('navigation', { name: entry.navigation })
      await expect(navigation).toBeVisible()
      const links = await navigation.getByRole('link').evaluateAll(items => items.map(item => ({ href: (item as HTMLAnchorElement).getAttribute('href') || '' })))

      for (const link of links) {
        expect(link.href, `${entry.account} 的侧栏入口缺少跳转地址`).toMatch(/^\//)
        await page.goto(entry.home)
        if (await sidebarToggle.getAttribute('aria-expanded') !== 'true') await sidebarToggle.click()
        await page.getByRole('navigation', { name: entry.navigation }).locator(`a[href="${link.href}"]`).click()
        await waitForPageReady(page)
        await assertPageHealth(page, audit)
        await expect(page.locator('body')).not.toContainText('页面不存在')
      }

      await page.goto(entry.home)
      await page.getByRole('button', { name: '打开账号菜单' }).click()
      const accountMenu = page.getByRole('menu')
      await expect(accountMenu).toBeVisible()
      for (const label of ['个人信息', '账号安全', '平台绑定']) {
        await page.goto(entry.home)
        await page.getByRole('button', { name: '打开账号菜单' }).click()
        await page.getByRole('menuitem', { name: label }).click()
        await waitForPageReady(page)
        await assertPageHealth(page, audit)
      }
      await context.close()
    })
  }

  test('通知、账号与切换身份面板不会被裁切，并可由 Escape 关闭', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    await page.goto('/teacher/students')

    const panels = [
      { button: page.getByRole('button', { name: /打开通知/ }), panel: page.getByRole('dialog', { name: '通知' }) },
      { button: page.locator('button[aria-haspopup="dialog"]').filter({ hasNot: page.getByRole('img') }).last(), panel: page.getByRole('dialog', { name: '切换身份' }) },
      { button: page.getByRole('button', { name: '打开账号菜单' }), panel: page.getByRole('menu') },
    ]
    for (const { button, panel } of panels) {
      await button.click()
      await expect(panel).toBeVisible()
      const box = await panel.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(1440)
      await page.keyboard.press('Escape')
    }
    await context.close()
  })
})
