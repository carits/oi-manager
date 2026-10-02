import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'

const ids = loadFixtureIds()
const organizationId = `org_${ids.school}`
const organizationBase = `/org/${organizationId}`

test.describe('training setup problem references @smoke @compact', () => {
  test.use({ storageState: accounts.principal.storageState })

  test('real local lookup resolves inline before adding to the unsaved training form', async ({ page }, testInfo) => {
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
    const selector = page.getByTestId('problem-reference-selector')
    await expect(selector).toBeVisible()
    await expect(selector).not.toContainText('检索结果')
    await expect(selector).not.toContainText('批量添加题目')

    await selector.getByRole('button', { name: '＋ 添加一道题目', exact: true }).click()
    await selector.getByLabel('题目平台', { exact: true }).selectOption(problem.platform)
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/problem-selection/resolve')
    await selector.getByRole('textbox', { name: '题号', exact: true }).fill(problem.problemId)
    const response = await responsePromise
    expect(response.ok()).toBe(true)
    const resolved = (await response.json()).data.items[0]
    expect(resolved.status).toBe('resolved')
    expect(resolved.problem.id).toBe(ids.problem)

    const link = selector.getByRole('link', { name: problem.title, exact: true })
    await expect(link).toBeVisible()
    await expect(page.locator('[aria-label="已选训练题目"]')).toHaveCount(0)

    await selector.getByRole('textbox', { name: '别名', exact: true }).fill('A')
    await selector.getByRole('button', { name: '完成', exact: true }).click()
    await expect(page.locator('[aria-label="已选训练题目"]').getByRole('link', { name: problem.title, exact: true })).toBeVisible()
    await expect(page.locator('[aria-label="已选训练题目"]')).toContainText('别名 A')
    expect(trainingWrites).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    await testInfo.attach('real-training-reference-inline', { body: await page.screenshot(), contentType: 'image/png' })
  })

  test('text edit stays inside the real setup dialog and keeps unresolved input for correction', async ({ page }, testInfo) => {
    await page.goto(`${organizationBase}/training-sessions`)
    await page.getByRole('button', { name: '布置训练', exact: true }).first().click()
    const selector = page.getByTestId('problem-reference-selector')
    await selector.getByRole('button', { name: '编辑', exact: true }).click()
    const editor = selector.getByRole('textbox', { name: '题目列表文本编辑' })
    const missingNumber = `not-in-local-library-${Date.now()}`
    await editor.fill(`carits | ${missingNumber} | A`)

    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/problem-selection/resolve')
    await selector.getByRole('button', { name: '确认', exact: true }).click()
    const response = await responsePromise
    expect(response.ok()).toBe(true)
    expect((await response.json()).data.items[0].status).toBe('not_found')

    await expect(selector.getByRole('alert')).toContainText('未找到')
    await expect(editor).toHaveValue(`carits | ${missingNumber} | A`)
    await expect(page.getByRole('dialog', { name: /批量添加/ })).toHaveCount(0)
    expect(await page.locator('form form').count()).toBe(0)
    await testInfo.attach('real-training-text-editor', { body: await page.screenshot(), contentType: 'image/png' })
  })
})
