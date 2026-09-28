import { expect, test, type Route } from '@playwright/test'
import { accounts } from '../fixtures/auth'

const school = '/org/org_school-default'
const listRoute = /\/api\/training-sessions(?:\?|$)/

test.describe('UI shell unification behavioral acceptance @smoke @compact', () => {
  test('account and personal navigation retain the same authenticated shell instance', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const documents: string[] = []
    page.on('request', request => { if (request.resourceType() === 'document') documents.push(request.url()) })
    await page.goto(`${school}/overview`)
    const shell = page.locator('[data-app-shell]')
    await expect(shell).toBeVisible()
    await shell.evaluate(element => { element.setAttribute('data-test-instance', 'retained-shell') })
    await page.getByRole('button', { name: '打开账号菜单' }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: '切换身份' })).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: '知识广场' })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: '个人信息' }).click()
    await expect(page).toHaveURL(/\/account\/profile$/)
    await expect(shell).toHaveAttribute('data-test-instance', 'retained-shell')
    const navigation = page.getByRole('navigation', { name: '个人主导航' })
    await expect(navigation).toBeVisible()
    await navigation.getByRole('link', { name: '团队', exact: true }).click()
    await expect(page).toHaveURL(/\/personal\/teams$/)
    await expect(shell).toHaveAttribute('data-test-instance', 'retained-shell')
    expect(documents).toHaveLength(1)
    await context.close()
  })

  test('school management has one primary parent while students remain directly accessible', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.principal.storageState, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await page.goto(`${school}/management?tab=students`)
    const navigation = page.getByRole('navigation', { name: '学校负责人主导航' })
    await expect(navigation.getByRole('link', { name: '学生', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('tablist', { name: '学校管理分区' })).toHaveCount(0)
    await navigation.getByRole('link', { name: '学校管理', exact: true }).click()
    await expect(page.getByRole('heading', { name: '学校管理', exact: true })).toBeVisible()
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(navigation.getByRole('link', { name: '学校管理', exact: true })).toHaveAttribute('aria-current', 'page')
    const tabs = page.getByRole('tablist', { name: '学校管理分区' })
    await tabs.getByRole('tab', { name: '教师与权限' }).click()
    await expect(page).toHaveURL(/\/management\?tab=teachers$/)
    await expect(navigation.getByRole('link', { name: '学校管理', exact: true })).toHaveAttribute('aria-current', 'page')
    await page.goBack()
    await expect(page).toHaveURL(/\/management\?tab=applications$/)
    await expect(tabs.getByRole('tab', { name: /加入申请/ })).toHaveAttribute('aria-selected', 'true')
    await context.close()
  })

  test('students can search and restore training filters without seeing manager actions', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const page = await context.newPage()
    await page.goto(`${school}/training-sessions?status=completed&q=复习`)
    const search = page.getByRole('searchbox', { name: '搜索训练' })
    await expect(search).toHaveValue('复习')
    await expect(page.getByRole('tab', { name: /已完成/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: '布置训练' })).toHaveCount(0)
    await page.getByRole('tab', { name: /进行中/ }).click()
    await expect(page).not.toHaveURL(/status=completed/)
    await page.goBack()
    await expect(page.getByRole('tab', { name: /已完成/ })).toHaveAttribute('aria-selected', 'true')
    await page.reload()
    await expect(search).toHaveValue('复习')
    await expect(page.getByRole('tab', { name: /已完成/ })).toHaveAttribute('aria-selected', 'true')
    await context.close()
  })

  test('first-read failure is not presented as no assigned training and can be retried', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const page = await context.newPage()
    const fail = (route: Route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: '训练读取验收错误' }) })
    await page.route(listRoute, fail)
    await page.goto(`${school}/training-sessions`)
    await expect(page.getByText('训练读取验收错误', { exact: true })).toBeVisible()
    await expect(page.getByText('目前老师还没有给你安排需要完成的训练。')).toHaveCount(0)
    await expect(page.locator('[data-app-header]')).toBeVisible()
    await page.unroute(listRoute, fail)
    await page.getByRole('button', { name: /重试|重新加载/ }).click()
    await expect(page.getByText('训练读取验收错误', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('searchbox', { name: '搜索训练' })).toBeVisible()
    await context.close()
  })

  test('a delayed previous filter cannot overwrite the current training results', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    let releaseOld!: () => void
    let oldStarted!: () => void
    let oldFinished!: () => void
    const oldStartedPromise = new Promise<void>(resolve => { oldStarted = resolve })
    const oldFinishedPromise = new Promise<void>(resolve => { oldFinished = resolve })
    const releasePromise = new Promise<void>(resolve => { releaseOld = resolve })
    await page.route(listRoute, async route => {
      const response = await route.fetch()
      const body = await response.json()
      expect(response.ok()).toBe(true)
      const active = new URL(route.request().url()).searchParams.get('statusGroup') === 'active'
      if (active) { oldStarted(); await releasePromise }
      await route.fulfill({ response, json: { ...body, data: { ...body.data, items: [], pagination: { ...body.data.pagination, page: 1, pageSize: 20, total: active ? 81 : 47, totalPages: active ? 5 : 3 } } } })
      if (active) oldFinished()
    })
    try {
      await page.goto(`${school}/training-sessions`)
      await oldStartedPromise
      await page.getByRole('tab', { name: /已结束/ }).click()
      await expect(page.getByText('共 47 个', { exact: true })).toBeVisible()
      releaseOld()
      await oldFinishedPromise
      await expect(page.getByText('共 47 个', { exact: true })).toBeVisible()
      await expect(page.getByText('共 81 个', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('tab', { name: /已结束/ })).toHaveAttribute('aria-selected', 'true')
    } finally { releaseOld(); await context.close() }
  })

  test('account menu supports keyboard navigation and returns focus without closing navigation', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState, viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    await page.goto(`${school}/overview`)
    const trigger = page.getByRole('button', { name: '打开账号菜单' })
    await trigger.click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: '个人信息' })).toBeFocused()
    await page.keyboard.press('End')
    await expect(menu.getByRole('menuitem', { name: '退出登录' })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(menu.getByRole('menuitem', { name: '个人信息' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(page.locator('[data-navigation-mode]')).toHaveAttribute('data-navigation-mode', 'expanded')
    await context.close()
  })
})
