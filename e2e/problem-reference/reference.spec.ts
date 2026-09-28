import { expect, test, type Page, type Route } from '@playwright/test'

type Input = { clientKey: string; platform: string; problemId: string }
const stableData = { slot: 'STABLE', graphHash: 'test-graph', fencingToken: 1, mode: 'acm' }
function row(item: Input) {
  if (item.problemId === 'missing') return { ...item, status: 'not_found' }
  if (item.problemId === 'conflict') return { ...item, status: 'identity_conflict' }
  return { ...item, status: item.problemId === 'draft' ? 'not_published' : 'resolved', problem: {
    id: `local-${item.platform}-${item.problemId}`, platform: item.platform, problemId: item.problemId,
    title: `题目 ${item.platform} ${item.problemId}`, ...(item.problemId === 'S' ? { stableData } : {}),
  } }
}
async function reply(route: Route, items: Input[]) {
  await route.fulfill({ json: { success: true, data: { items: items.map(row) } } })
}
async function api(page: Page) {
  const requests: Input[][] = []
  await page.route('**/api/problem-selection/resolve', async route => {
    const items = route.request().postDataJSON().items as Input[]
    requests.push(items)
    await reply(route, items)
  })
  return requests
}
const picker = (page: Page) => page.getByTestId('problem-reference-selector')
const number = (page: Page) => picker(page).getByRole('textbox', { name: '题号', exact: true })
const add = (page: Page) => picker(page).getByRole('button', { name: '添加', exact: true })
const selected = (page: Page) => page.getByTestId('selected').locator('li')
async function openBatch(page: Page, value: string) {
  await picker(page).getByRole('button', { name: '批量添加题目', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '批量添加题目', exact: true })
  await dialog.getByRole('textbox', { name: '批量题号' }).fill(value)
  return dialog
}

test('single lookup shows a linked title before explicit addition and never submits the parent form', async ({ page }, testInfo) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  await expect(picker(page).locator('textarea')).toHaveCount(0)
  await number(page).fill('A')
  const link = picker(page).getByRole('link', { name: '题目 carits A', exact: true })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', /\/personal\/problems\/local-carits-A/)
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(selected(page)).toHaveCount(0)
  expect(requests).toEqual([[{ clientKey: 'single', platform: 'carits', problemId: 'A' }]])
  const popupPromise = page.waitForEvent('popup')
  await link.click()
  const popup = await popupPromise
  await expect(popup).toHaveURL(/\/personal\/problems\/local-carits-A/)
  await popup.close()
  await expect(number(page)).toHaveValue('A')
  await add(page).click()
  await expect(selected(page)).toHaveCount(1)
  await expect(number(page)).toHaveValue('')
  await expect(page.getByTestId('form-submits')).toHaveText('0')
  if (testInfo.project.name === 'chromium') await testInfo.attach('single-reference', { body: await page.screenshot(), contentType: 'image/png' })
})

for (const host of ['训练创建', '训练设计', '训练追加', '比赛', '作业', '题单']) {
  test(`${host}: identical reference control preserves the host Stable policy`, async ({ page }) => {
    await api(page)
    await page.goto('/personal/training-sessions')
    await page.getByLabel('业务入口', { exact: true }).selectOption(host)
    await number(page).fill('A')
    await expect(picker(page).getByRole('link', { name: '题目 carits A', exact: true })).toBeVisible()
    if (host === '比赛' || host === '作业') {
      await expect(picker(page)).toContainText('Stable')
      await expect(add(page)).toBeDisabled()
      await number(page).fill('S')
    }
    await expect(add(page)).toBeEnabled()
    await add(page).click()
    await expect(selected(page)).toHaveCount(1)
  })
}

test('Enter flushes the timer once and remains a lookup, not an implicit add', async ({ page }) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  await number(page).fill('A')
  await number(page).press('Enter')
  await expect(add(page)).toBeEnabled()
  await page.waitForTimeout(650) // Wait past the original debounce deadline to catch a second request.
  expect(requests).toHaveLength(1)
  await expect(selected(page)).toHaveCount(0)
  await expect(page.getByTestId('form-submits')).toHaveText('0')
})

test('composition does not query unfinished input', async ({ page }) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  await number(page).dispatchEvent('compositionstart')
  await number(page).fill('A')
  await page.waitForTimeout(550)
  expect(requests).toHaveLength(0)
  await number(page).dispatchEvent('compositionend')
  await expect(add(page)).toBeEnabled()
  expect(requests).toHaveLength(1)
})

test('single field rejects multi-number input, long numbers and URLs without sending a request', async ({ page }) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  for (const value of ['A B', 'A'.repeat(129), 'https://example.test/problem/A']) {
    await number(page).fill(value)
    await expect(number(page)).toHaveAttribute('aria-invalid', 'true')
    await number(page).press('Enter')
    await expect(add(page)).toBeDisabled()
  }
  expect(requests).toHaveLength(0)
})

test('a late response cannot replace a newer number or platform', async ({ page }) => {
  let release: (() => void) | undefined
  let held = false
  await page.route('**/api/problem-selection/resolve', async route => {
    const items = route.request().postDataJSON().items as Input[]
    if (items[0].platform === 'carits' && items[0].problemId === '001') {
      held = true
      await new Promise<void>(resolve => { release = resolve })
    }
    await reply(route, items).catch(() => undefined) // The deliberately stale transport can already be aborted.
  })
  await page.goto('/personal/training-sessions')
  await number(page).fill('001')
  await expect.poll(() => held).toBe(true)
  await picker(page).getByLabel('题目平台', { exact: true }).selectOption('luogu')
  await number(page).fill('P0001')
  await expect(picker(page).getByRole('link', { name: '题目 luogu P0001', exact: true })).toBeVisible()
  release?.()
  await page.waitForTimeout(100)
  await expect(picker(page).getByRole('link', { name: '题目 carits 001', exact: true })).toHaveCount(0)
  await add(page).click()
  await expect(selected(page)).toHaveCount(1)
  await expect(selected(page)).toContainText('P0001')
})

test('request failure, absent, unpublished and conflicting identities stay distinguishable', async ({ page }) => {
  let fail = true
  await page.route('**/api/problem-selection/resolve', async route => {
    const items = route.request().postDataJSON().items as Input[]
    if (fail) { fail = false; await route.fulfill({ status: 503, json: { success: false, message: '临时检索故障' } }); return }
    await reply(route, items)
  })
  await page.goto('/personal/training-sessions')
  await number(page).fill('A')
  await expect(picker(page).getByRole('button', { name: '重新检索' })).toBeVisible()
  await expect(add(page)).toBeDisabled()
  await picker(page).getByRole('button', { name: '重新检索' }).click()
  await expect(add(page)).toBeEnabled()
  for (const [value, message] of [['missing', '未找到'], ['draft', '尚未发布'], ['conflict', '重复记录']]) {
    await number(page).fill(value)
    await expect(picker(page)).toContainText(message)
    await expect(add(page)).toBeDisabled()
  }
  await expect(selected(page)).toHaveCount(0)
})

test('a failed business add leaves the resolved number available for retry', async ({ page }) => {
  await api(page)
  await page.goto('/personal/training-sessions')
  await page.getByLabel('接收模式').selectOption('error')
  await number(page).fill('A')
  await expect(add(page)).toBeEnabled()
  await add(page).click()
  await expect(picker(page).getByRole('alert')).toContainText('业务暂时不可用')
  await expect(number(page)).toHaveValue('A')
  await expect(selected(page)).toHaveCount(0)
  await page.getByLabel('接收模式').selectOption('all')
  await add(page).click()
  await expect(selected(page)).toHaveCount(1)
})

test('batch lookup is explicit and partial business acceptance preserves failed rows without re-adding successes', async ({ page }, testInfo) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  await page.getByLabel('接收模式').selectOption('partial')
  const dialog = await openBatch(page, 'A B missing A')
  await expect(dialog.getByRole('button', { name: '加入 0 道题' })).toBeDisabled()
  expect(requests).toHaveLength(0)
  await dialog.getByRole('button', { name: '检索', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '加入 2 道题' })).toBeEnabled()
  expect(requests[0].map(item => item.problemId)).toEqual(['A', 'B', 'missing'])
  await dialog.getByRole('button', { name: '加入 2 道题' }).click()
  await expect(selected(page)).toHaveCount(1)
  await expect(dialog).toContainText('该题详情加载失败')
  await expect(dialog.getByRole('textbox', { name: '批量题号' })).toHaveValue('A B missing A')
  await dialog.getByRole('button', { name: '加入 1 道题' }).click()
  await expect(selected(page)).toHaveCount(2)
  await expect(page.getByTestId('add-calls')).toHaveText('2')
  await expect(dialog).toContainText('未找到')
  await expect(dialog.getByRole('button', { name: '加入 0 道题' })).toBeDisabled()
  if (testInfo.project.name === 'chromium') await testInfo.attach('batch-partial', { body: await page.screenshot(), contentType: 'image/png' })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '放弃并关闭' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(selected(page)).toHaveCount(2)
  await expect(page.getByTestId('form-submits')).toHaveText('0')
})

test('batch preview rechecks current selected IDs and rejects oversized input without truncation', async ({ page }) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  const dialog = await openBatch(page, 'A')
  await dialog.getByRole('button', { name: '检索', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '加入 1 道题' })).toBeEnabled()
  await page.getByRole('button', { name: '外部选入 A', exact: true }).evaluate(button => (button as HTMLButtonElement).click())
  await expect(dialog.getByRole('button', { name: '加入 0 道题' })).toBeDisabled()
  const oversized = Array.from({ length: 101 }, (_, index) => `P${index}`).join('\n')
  await dialog.getByRole('textbox', { name: '批量题号' }).fill(oversized)
  await expect(dialog.getByRole('alert')).toContainText('未截断')
  await expect(dialog.getByRole('button', { name: '检索', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('textbox', { name: '批量题号' })).toHaveValue(oversized)
  expect(requests).toHaveLength(1)
})

test('closing a pending batch aborts it and reopening starts with an empty input', async ({ page }) => {
  let release: (() => void) | undefined
  let held = false
  await page.route('**/api/problem-selection/resolve', async route => {
    const items = route.request().postDataJSON().items as Input[]
    held = true
    await new Promise<void>(resolve => { release = resolve })
    await reply(route, items).catch(() => undefined)
  })
  await page.goto('/personal/training-sessions')
  const dialog = await openBatch(page, 'A')
  await dialog.getByRole('button', { name: '检索', exact: true }).click()
  await expect.poll(() => held).toBe(true)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '放弃并关闭' }).click()
  release?.()
  const reopened = await openBatch(page, '')
  await expect(reopened.getByRole('textbox', { name: '批量题号' })).toHaveValue('')
  await expect(reopened.getByRole('link')).toHaveCount(0)
})

test('disabling or unmounting while resolving never accepts the old response', async ({ page }) => {
  let release: (() => void) | undefined
  let held = false
  await page.route('**/api/problem-selection/resolve', async route => {
    const items = route.request().postDataJSON().items as Input[]
    held = true
    await new Promise<void>(resolve => { release = resolve })
    await reply(route, items).catch(() => undefined)
  })
  await page.goto('/personal/training-sessions')
  await number(page).fill('A')
  await expect.poll(() => held).toBe(true)
  await page.getByRole('button', { name: '切换禁用', exact: true }).click()
  release?.()
  await expect(add(page)).toBeDisabled()
  await expect(picker(page).getByRole('link')).toHaveCount(0)
  await page.getByRole('button', { name: '切换挂载', exact: true }).click()
  await page.getByRole('button', { name: '切换挂载', exact: true }).click()
  await expect(number(page)).toHaveValue('')
})

for (const change of ['工作区', '阶段']) {
  test(`async additions are single-flight and invalidated on ${change} change`, async ({ page }) => {
    await api(page)
    await page.goto('/personal/training-sessions')
    await page.getByLabel('接收模式').selectOption('delayed')
    await number(page).fill('A')
    await expect(add(page)).toBeEnabled()
    await add(page).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click() })
    await expect(page.getByTestId('add-calls')).toHaveText('1')
    if (change === '工作区') await page.getByLabel('工作区', { exact: true }).selectOption('org-a')
    else await page.getByRole('button', { name: '切换阶段', exact: true }).click()
    await page.getByRole('button', { name: '完成异步添加', exact: true }).click()
    await expect(selected(page)).toHaveCount(0)
    await expect(number(page)).toHaveValue('')
  })
}

test('localStorage failure does not break selection and incomplete responses are not treated as success', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error('storage blocked') }; Storage.prototype.setItem = () => { throw new Error('storage blocked') } })
  await page.route('**/api/problem-selection/resolve', route => route.fulfill({ json: { success: true, data: { items: [] } } }))
  await page.goto('/personal/training-sessions')
  await picker(page).getByLabel('题目平台', { exact: true }).selectOption('luogu')
  await number(page).fill('P0001')
  await expect(picker(page)).toContainText('响应不完整')
  await expect(add(page)).toBeDisabled()
  await page.unroute('**/api/problem-selection/resolve')
  await api(page)
  await picker(page).getByRole('button', { name: '重新检索' }).click()
  await expect(add(page)).toBeEnabled()
})

test('narrow hosts wrap long titles and batch overlays remain viewport-sized', async ({ page }) => {
  await api(page)
  await page.goto('/personal/training-sessions')
  await page.locator('#host').evaluate(element => { (element as HTMLElement).style.width = '340px' })
  await number(page).fill('A'.repeat(120))
  await expect(add(page)).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  const dialog = await openBatch(page, 'A')
  const overlay = await dialog.evaluate(element => ({ width: element.parentElement!.getBoundingClientRect().width, viewport: window.innerWidth }))
  expect(Math.abs(overlay.width - overlay.viewport)).toBeLessThanOrEqual(1)
  expect(await page.locator('form form').count()).toBe(0)
})
