import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { accounts, type AuthRole } from '../fixtures/auth'
import { loginAs } from '../fixtures/api'
import { waitForPageReady } from '../support/page-audit'

const organizationBase = '/org/org_school-default'

async function createPublicPost(request: APIRequestContext) {
  await loginAs(request, 'personalStudent')
  const slug = `workspace-knowledge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const created = await request.post('/api/blogs', { data: {
    type: 'ARTICLE',
    slug,
    title: '工作区知识导航测试',
    summary: '用于验证身份、导航和互动状态不会在知识广场丢失。',
    contentMarkdown: '# 工作区知识导航\n\n正文内容。',
    references: [],
  } })
  expect(created.status()).toBe(201)
  const post = (await created.json()).data
  const published = await request.post(`/api/blogs/${post.id}/publish`, { data: { expectedDraftRevision: post.draft.revision, visibility: 'PUBLIC' } })
  expect(published.status()).toBe(200)
  return { id: post.id as string, slug }
}

async function openNavigation(page: Page, name: string) {
  const navigation = page.getByRole('navigation', { name })
  await page.waitForTimeout(150)
  if (!await navigation.isVisible()) await page.locator('[aria-controls="app-sidebar"]').click()
  await expect(navigation).toBeVisible()
  return navigation
}

const workspaceCases: Array<{ role: AuthRole; start: string; expected: string; navigation: string }> = [
  { role: 'teacher', start: `${organizationBase}/overview`, expected: `${organizationBase}/knowledge`, navigation: '教师主导航' },
  { role: 'campusStudent', start: `${organizationBase}/overview`, expected: `${organizationBase}/knowledge`, navigation: '学生主导航' },
  { role: 'personalStudent', start: '/personal', expected: '/personal/knowledge', navigation: '个人主导航' },
  { role: 'superAdmin', start: '/admin', expected: '/admin/knowledge', navigation: '超级管理员主导航' },
  { role: 'platformAdmin', start: '/platform-admin', expected: '/platform-admin/knowledge', navigation: '平台管理员主导航' },
]

test.describe('知识广场跨工作区一致性 @smoke @compact', () => {
  for (const entry of workspaceCases) {
    test(`${entry.role} 进入知识广场后保留原工作区`, async ({ browser }) => {
      const context = await browser.newContext({ storageState: accounts[entry.role].storageState })
      const page = await context.newPage()
      await page.goto(entry.start)
      await waitForPageReady(page)
      const navigation = await openNavigation(page, entry.navigation)
      await navigation.getByRole('link', { name: '知识广场' }).click()
      await expect(page).toHaveURL(new RegExp(`${entry.expected.replaceAll('/', '\\/')}$`))
      await expect(page.locator('#app-sidebar')).toHaveCount(1)
      await expect(page.getByRole('navigation', { name: entry.navigation })).toBeVisible()
      await context.close()
    })
  }

  test('知识广场切换个人与校园工作区时保留当前模块', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    await page.goto(`${organizationBase}/knowledge`)
    await page.getByRole('button', { name: '切换工作区' }).click()
    await page.getByRole('region', { name: '切换工作区' }).getByRole('button', { name: /^个人/ }).click()
    await expect(page).toHaveURL(/\/personal\/knowledge$/)
    await page.getByRole('button', { name: '切换工作区' }).click()
    await page.getByRole('region', { name: '切换工作区' }).getByRole('button', { name: /^E2E School\s*教师/ }).click()
    await expect(page).toHaveURL(new RegExp(`${organizationBase.replaceAll('/', '\\/')}\/knowledge$`))
    await context.close()
  })

  test('真实文章在校园工作区可互动且不会跳回身份选择', async ({ browser, request }) => {
    const post = await createPublicPost(request)
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    await page.goto(`${organizationBase}/knowledge/${post.slug}`)
    await waitForPageReady(page)
    await openNavigation(page, '教师主导航')
    await page.getByRole('button', { name: /^喜欢/ }).click()
    await expect(page).toHaveURL(`${organizationBase}/knowledge/${post.slug}`)
    await expect(page).not.toHaveURL(/\/identity|\/login/)
    await context.close()
  })

  test('匿名互动登录入口保留文章返回路径', async ({ browser, request }) => {
    const post = await createPublicPost(request)
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await context.newPage()
    await page.goto(`/blog/${post.slug}`)
    await page.getByPlaceholder('登录后参与讨论').focus()
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(`/blog/${post.slug}`)}`))
    await context.close()
  })

  test('社区读取失败显示错误和重试而不是零互动', async ({ browser, request }) => {
    const post = await createPublicPost(request)
    const context = await browser.newContext({ storageState: accounts.personalStudent.storageState })
    const page = await context.newPage()
    await page.route(`**/api/blog-discovery/${post.id}/community`, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: '互动服务暂不可用' }), headers: { 'x-request-id': 'community-e2e' } }))
    await page.goto(`/personal/knowledge/${post.slug}`)
    const communityError = page.getByText(/互动服务暂不可用（请求 ID：community-e2e）/)
    await expect(communityError).toBeVisible()
    await expect(page.getByText('还没有评论')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    await context.close()
  })

  test('Blog 元数据字段变更也会阻止 SPA 导航丢草稿', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.personalStudent.storageState })
    const page = await context.newPage()
    await page.goto('/personal/blogs/new')
    await page.getByLabel('文章地址').fill(`dirty-${Date.now()}`)
    const navigation = await openNavigation(page, '个人主导航')
    await navigation.getByRole('link', { name: '比赛' }).click()
    const dialog = page.getByRole('dialog', { name: '有未保存的更改' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '继续编辑' }).click()
    await expect(page).toHaveURL(/\/personal\/blogs\/new$/)
    await navigation.getByRole('link', { name: '比赛' }).click()
    await page.getByRole('dialog', { name: '有未保存的更改' }).getByRole('button', { name: '放弃更改并离开' }).click()
    await expect(page).toHaveURL(/\/personal\/contests$/)
    await context.close()
  })

  test('管理员账号页 Logo 直接返回管理首页', async ({ browser }) => {
    for (const entry of [{ role: 'superAdmin' as const, home: '/admin' }, { role: 'platformAdmin' as const, home: '/platform-admin' }]) {
      const context = await browser.newContext({ storageState: accounts[entry.role].storageState })
      const page = await context.newPage()
      await page.goto('/account/profile')
      await page.getByRole('link', { name: '返回首页' }).first().click()
      await expect(page).toHaveURL(new RegExp(`${entry.home.replaceAll('/', '\\/')}$`))
      await context.close()
    }
  })

  test('已登录用户访问 login 时尊重安全 next 而不是进入身份选择', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.personalStudent.storageState })
    const page = await context.newPage()
    await page.goto('/login?next=%2Fpersonal%2Fknowledge')
    await expect(page).toHaveURL(/\/personal\/knowledge$/)
    await expect(page.locator('#app-sidebar')).toHaveCount(1)
    await context.close()
  })
})
