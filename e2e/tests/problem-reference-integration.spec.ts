import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'

const ids = loadFixtureIds()
const organizationId = `org_${ids.school}`
const organizationBase = `/org/${organizationId}`

test.describe('training setup problem references @smoke @compact', () => {
  test.use({ storageState: accounts.principal.storageState })

  test('real local lookup previews a linked problem before adding to the unsaved training form', async ({ page }, testInfo) => {
    const metadataResponse = await page.request.get(`/api/problems/${ids.problem}`, { headers: { 'X-OI-Organization-ID': organizationId } })
    expect(metadataResponse.ok()).toBe(true)
    const { data: problem } = await metadataResponse.json()
    expect(problem.id).toBe(ids.problem)
    expect(typeof problem.platform).toBe('string')
    expect(typeof problem.problemId).toBe('string')
    let trainingWrites = 0
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/training-sessions') trainingWrites += 1
    })
    await page.goto(`${organizationBase}/training-sessions`)
    await page.getByRole('button', { name: '布置训练', exact: true }).first().click()
    const selector = page.getByTestId('problem-reference-selector')
    await expect(selector).toBeVisible()
    await expect(selector.locator('textarea')).toHaveCount(0)
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
    await expect(link).toHaveAttribute('href', new RegExp(`${organizationBase}/problems/${ids.problem}`))
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(page.locator('[aria-label="已选训练题目"]')).toHaveCount(0)
    await selector.scrollIntoViewIfNeeded()
    await testInfo.attach('real-training-reference', { body: await page.screenshot(), contentType: 'image/png' })
    await selector.getByRole('button', { name: '添加', exact: true }).click()
    await expect(page.locator('[aria-label="已选训练题目"]').getByRole('link', { name: problem.title, exact: true })).toBeVisible()
    await expect(selector.getByRole('textbox', { name: '题号', exact: true })).toHaveValue('')
    expect(trainingWrites).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })

  test('batch overlay escapes the real setup dialog and an absent local number is retained', async ({ page }, testInfo) => {
    await page.goto(`${organizationBase}/training-sessions`)
    await page.getByRole('button', { name: '布置训练', exact: true }).first().click()
    await page.getByTestId('problem-reference-selector').getByRole('button', { name: '批量添加题目', exact: true }).click()
    const batch = page.getByRole('dialog', { name: '批量添加题目', exact: true })
    await expect(batch).toBeVisible()
    const missingNumber = `not-in-local-library-${Date.now()}`
    await batch.getByRole('textbox', { name: '批量题号' }).fill(missingNumber)
    const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/problem-selection/resolve')
    await batch.getByRole('button', { name: '检索', exact: true }).click()
    const response = await responsePromise
    expect(response.ok()).toBe(true)
    expect((await response.json()).data.items[0].status).toBe('not_found')
    await expect(batch).toContainText('未找到')
    await expect(batch.getByRole('button', { name: '加入 0 道题' })).toBeDisabled()
    await expect(batch.getByRole('textbox', { name: '批量题号' })).toHaveValue(missingNumber)
    const geometry = await batch.evaluate(dialog => ({ overlay: dialog.parentElement!.getBoundingClientRect().width, viewport: window.innerWidth, nestedForm: Boolean(dialog.closest('form')) }))
    expect(Math.abs(geometry.overlay - geometry.viewport)).toBeLessThanOrEqual(1)
    expect(geometry.nestedForm).toBe(false)
    await testInfo.attach('real-training-batch', { body: await page.screenshot(), contentType: 'image/png' })
    await batch.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '放弃并关闭', exact: true }).click()
    await expect(batch).toHaveCount(0)
    await expect(page.getByTestId('problem-reference-selector')).toBeVisible()
  })
})
