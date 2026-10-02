import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'

const ids = loadFixtureIds()
const organizationId = `org_${ids.school}`
const organizationBase = `/org/${organizationId}`

test.describe('training setup problem list editor @smoke @compact', () => {
  test.use({ storageState: accounts.principal.storageState })

  test('real local lookup resolves automatically inside the unsaved training form', async ({ page }, testInfo) => {
    const metadataResponse = await page.request.get(`/api/problems/${ids.problem}`, { headers: { 'X-OI-Organization-ID': organizationId } })
    expect(metadataResponse.ok()).toBe(true)
    const { data: problem } = await metadataResponse.json()
    expect(problem.id).toBe(ids.problem)

    let trainingWrites = 0
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/training-sessions') trainingWrites += 1
    })

    await page.goto(`${organizationBase}/training-sessions`)
    await page.getByRole('button', { name: '布置训练', exact: true }).first().click()
    const editor = page.getByTestId('problem-list-editor')
    await expect(editor).toBeVisible()
    await expect(editor).not.toContainText('检索结果')
    await expect(editor).not.toContainText('批量添加题目')
    await expect(editor.getByRole('button', { name: '完成', exact: true })).toHaveCount(0)

    await editor.getByRole('button', { name: '＋ 添加一道题目', exact: true }).click()
    await editor.getByLabel('第 1 题平台', { exact: true }).selectOption(problem.platform)
    await editor.getByRole('textbox', { name: '第 1 题别名', exact: true }).fill('A')
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/problem-selection/resolve')
    await editor.getByRole('textbox', { name: '第 1 题题号', exact: true }).fill(problem.problemId)
    const response = await responsePromise
    expect(response.ok()).toBe(true)
    const resolved = (await response.json()).data.items[0]
    expect(resolved.status).toBe('resolved')
    expect(resolved.problem.id).toBe(ids.problem)

    await expect(editor.getByRole('link', { name: problem.title, exact: true })).toBeVisible()
    await expect(editor.getByRole('textbox', { name: '第 1 题别名', exact: true })).toHaveValue('A')
    expect(trainingWrites).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    await testInfo.attach('real-training-row-editor', { body: await page.screenshot(), contentType: 'image/png' })
  })

  test('text edit returns to the list and keeps unresolved rows visible for correction', async ({ page }, testInfo) => {
    const metadataResponse = await page.request.get(`/api/problems/${ids.problem}`, { headers: { 'X-OI-Organization-ID': organizationId } })
    expect(metadataResponse.ok()).toBe(true)
    const { data: problem } = await metadataResponse.json()
    await page.goto(`${organizationBase}/training-sessions`)
    await page.getByRole('button', { name: '布置训练', exact: true }).first().click()
    const editor = page.getByTestId('problem-list-editor')
    await editor.getByRole('button', { name: '编辑', exact: true }).click()
    const textarea = editor.getByRole('textbox', { name: '题目列表文本编辑' })
    const missingNumber = `not-in-local-library-${Date.now()}`
    await textarea.fill(`${problem.platform} | ${problem.problemId} | A\ncarits | ${missingNumber} | B`)
    await editor.getByRole('button', { name: '确认', exact: true }).click()

    await expect(textarea).toHaveCount(0)
    await expect(editor).toContainText('未找到')
    await expect(editor.getByRole('textbox', { name: '第 2 题题号', exact: true })).toHaveValue(missingNumber)
    await expect(page.getByRole('dialog', { name: /批量添加/ })).toHaveCount(0)
    expect(await page.locator('form form').count()).toBe(0)
    await testInfo.attach('real-training-partial-text-editor', { body: await page.screenshot(), contentType: 'image/png' })
  })
})
