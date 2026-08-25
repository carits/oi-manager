import { expect, test } from '@playwright/test'
import { bearer, loginAs } from '../fixtures/api'
import { accounts } from '../fixtures/auth'

test('platform administrator can migrate and use the visual OI Test Graph workbench @compact', async ({ browser, request }) => {
  const manager = await loginAs(request, 'platformAdmin')
  const headers = bearer(manager)
  const created = await request.post('/api/problems', {
    headers,
    data: {
      title: 'E2E OI Test Graph Workbench',
      description: 'Visual Test Graph fixture',
      timeLimit: 1000,
      memoryLimit: 256,
      status: 'draft',
    },
  })
  expect(created.status()).toBe(201)
  const problemId = String((await created.json()).data.id)

  for (const file of [
    { name: '1.in', mimeType: 'text/plain', buffer: Buffer.from('1 2\n') },
    { name: '1.out', mimeType: 'text/plain', buffer: Buffer.from('3\n') },
  ]) {
    const upload = await request.post(`/api/problems/${problemId}/testdata`, { headers, multipart: { files: file } })
    expect(upload.status()).toBe(200)
  }

  const config = await request.put(`/api/problems/${problemId}/judge-config`, {
    headers,
    data: {
      problemType: 'default',
      timeLimit: 1000,
      memoryLimit: 256,
      config: {
        mode: 'oi',
        type: 'default',
        checker_type: 'default',
        time: '1000ms',
        memory: '256MB',
        subtasks: [{ id: 1, score: 100, type: 'min', cases: [{ input: '1.in', output: '1.out' }] }],
      },
    },
  })
  expect(config.status()).toBe(200)

  const context = await browser.newContext({ storageState: accounts.platformAdmin.storageState })
  const page = await context.newPage()
  await page.goto(`/platform-admin/problems/${problemId}/edit`)
  await page.getByRole('button', { name: '评测设置', exact: true }).click()

  await expect(page.getByRole('button', { name: '数据与分组', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '子任务', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '测试数据', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '数据与分组', exact: true }).click()

  await expect(page.getByRole('heading', { name: '此题尚未迁移到 OI Test Graph' })).toBeVisible()
  await page.getByRole('button', { name: '迁移并进入工作台' }).click()
  const confirmation = page.getByRole('dialog', { name: '迁移此题的 OI 测试图？' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: '确认迁移' }).click()

  await expect(page.getByLabel('Subtask 列表')).toBeVisible()
  await expect(page.getByLabel('Group 配置')).toBeVisible()
  await expect(page.getByLabel('Testcase 测试点池')).toBeVisible()
  await expect(page.getByText('系统 Hack Gate', { exact: true })).toBeVisible()
  await expect(page.getByText('总分 100/100', { exact: true })).toBeVisible()
  await expect(page.locator('textarea')).toHaveCount(0)
  await expect(page.getByText('1.in', { exact: true }).first()).toBeVisible()

  const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(overflow.width).toBeLessThanOrEqual(overflow.client + 1)

  await page.getByRole('button', { name: '添加', exact: true }).click()
  await expect(page.getByText('总分 100/100', { exact: true })).toBeVisible()
  await expect(page.getByText(/个问题/).first()).toBeVisible()
  await page.getByRole('button', { name: '基础配置', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '确认操作' })).toContainText('存在未保存修改')
  await page.getByRole('dialog', { name: '确认操作' }).getByRole('button', { name: '取消' }).click()

  await context.close()
})
