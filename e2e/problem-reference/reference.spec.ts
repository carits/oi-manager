import { expect, test, type Page, type Route } from '@playwright/test'

type Input = { clientKey: string; platform: string; problemId: string }
const stableData = { slot: 'STABLE', graphHash: 'test-graph', fencingToken: 1, mode: 'acm' }
const evolvingData = { slot: 'EVOLVING', graphHash: 'test-evolving', fencingToken: 2, mode: 'acm' }

function row(item: Input) {
  if (item.problemId === 'missing') return { ...item, status: 'not_found' }
  if (item.problemId === 'conflict') return { ...item, status: 'identity_conflict' }
  if (item.problemId === 'draft') return { ...item, status: 'not_published', message: '该题尚未发布，暂不能添加' }
  return {
    ...item,
    status: 'resolved',
    problem: {
      id: `local-${item.platform}-${item.problemId}`,
      platform: item.platform,
      problemId: item.problemId,
      title: `题目 ${item.platform} ${item.problemId}`,
      ...(item.problemId === 'S' ? { stableData } : { evolvingData }),
    },
  }
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
const complete = (page: Page) => picker(page).getByRole('button', { name: '完成', exact: true })
const selected = (page: Page) => page.getByTestId('selected').locator('li')

async function beginAdd(page: Page) {
  await picker(page).getByRole('button', { name: '＋ 添加一道题目', exact: true }).click()
}

test('one problem is entered as a row, resolved inline and added without submitting the parent form', async ({ page }, testInfo) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  await expect(picker(page)).not.toContainText('检索结果')
  await expect(picker(page)).not.toContainText('批量添加题目')

  await beginAdd(page)
  await picker(page).getByRole('textbox', { name: '别名', exact: true }).fill('Warmup')
  await number(page).fill('A')

  const link = picker(page).getByRole('link', { name: '题目 carits A', exact: true })
  await expect(link).toBeVisible()
  expect(requests).toEqual([[{ clientKey: 'single', platform: 'carits', problemId: 'A' }]])

  await complete(page).click()
  await expect(selected(page)).toHaveCount(1)
  await expect(selected(page)).toContainText('Warmup')
  await expect(page.getByTestId('form-submits')).toHaveText('0')
  await testInfo.attach('inline-problem-entry', { body: await page.screenshot(), contentType: 'image/png' })
})

for (const host of ['训练创建', '训练设计', '训练追加', '比赛', '作业', '题单']) {
  test(`${host}: shared editor preserves the business readiness policy`, async ({ page }) => {
    await api(page)
    await page.goto('/personal/training-sessions')
    await page.getByLabel('业务入口', { exact: true }).selectOption(host)
    await beginAdd(page)
    await number(page).fill('A')
    await expect(picker(page).getByRole('link', { name: '题目 carits A', exact: true })).toBeVisible()

    if (host === '比赛' || host === '作业') {
      await expect(picker(page)).toContainText('Stable')
      await number(page).fill('S')
      await expect(picker(page).getByRole('link', { name: '题目 carits S', exact: true })).toBeVisible()
    }

    await complete(page).click()
    await expect(selected(page)).toHaveCount(1)
  })
}

test('Enter means finish this row, not a separate search action', async ({ page }) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  await beginAdd(page)
  await picker(page).getByRole('textbox', { name: '别名', exact: true }).fill('A')
  await number(page).fill('A')
  await number(page).press('Enter')
  await expect(selected(page)).toHaveCount(1)
  expect(requests).toHaveLength(1)
  await expect(page.getByTestId('form-submits')).toHaveText('0')
})

test('composition does not resolve unfinished input', async ({ page }) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  await beginAdd(page)
  await number(page).focus()
  await number(page).evaluate(element => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, 'A')
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'A', inputType: 'insertCompositionText', isComposing: true }))
  })
  await page.waitForTimeout(550)
  expect(requests).toHaveLength(0)
  await number(page).evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'A' })))
  await expect(picker(page).getByRole('link', { name: '题目 carits A', exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)
})

test('late responses cannot replace a newer platform and number', async ({ page }) => {
  let release: (() => void) | undefined
  let held = false
  await page.route('**/api/problem-selection/resolve', async route => {
    const items = route.request().postDataJSON().items as Input[]
    if (items[0].platform === 'carits' && items[0].problemId === '001') {
      held = true
      await new Promise<void>(resolve => { release = resolve })
    }
    await reply(route, items).catch(() => undefined)
  })
  await page.goto('/personal/training-sessions')
  await beginAdd(page)
  await number(page).fill('001')
  await expect.poll(() => held).toBe(true)
  await picker(page).getByLabel('题目平台', { exact: true }).selectOption('luogu')
  await number(page).fill('P0001')
  await expect(picker(page).getByRole('link', { name: '题目 luogu P0001', exact: true })).toBeVisible()
  release?.()
  await page.waitForTimeout(100)
  await expect(picker(page).getByRole('link', { name: '题目 carits 001', exact: true })).toHaveCount(0)
  await complete(page).click()
  await expect(selected(page)).toContainText('P0001')
})

test('unpublished problems expose status but not title or internal link', async ({ page }) => {
  await api(page)
  await page.goto('/personal/training-sessions')
  await beginAdd(page)
  await number(page).fill('draft')
  await expect(picker(page)).toContainText('尚未发布')
  await expect(picker(page).getByRole('link')).toHaveCount(0)
  await expect(picker(page)).not.toContainText('题目 carits draft')
  await complete(page).click()
  await expect(selected(page)).toHaveCount(0)
})

test('business failure keeps the editable row for retry', async ({ page }) => {
  await api(page)
  await page.goto('/personal/training-sessions')
  await page.getByLabel('接收模式').selectOption('error')
  await beginAdd(page)
  await number(page).fill('A')
  await expect(picker(page).getByRole('link', { name: '题目 carits A' })).toBeVisible()
  await complete(page).click()
  await expect(picker(page).getByRole('alert')).toContainText('业务暂时不可用')
  await expect(number(page)).toHaveValue('A')

  await page.getByLabel('接收模式').selectOption('all')
  await complete(page).click()
  await expect(selected(page)).toHaveCount(1)
})

test('Edit switches the current list directly to text and replaces it on confirm', async ({ page }, testInfo) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')

  await beginAdd(page)
  await picker(page).getByRole('textbox', { name: '别名', exact: true }).fill('A')
  await number(page).fill('A')
  await complete(page).click()
  await expect(selected(page)).toHaveCount(1)

  await picker(page).getByRole('button', { name: '编辑', exact: true }).click()
  const textarea = picker(page).getByRole('textbox', { name: '题目列表文本编辑' })
  await expect(textarea).toHaveValue('carits | A | A')
  await textarea.fill('luogu | B | Bee\ncarits | C | See')
  await picker(page).getByRole('button', { name: '确认', exact: true }).click()

  await expect(selected(page)).toHaveCount(2)
  await expect(selected(page).nth(0)).toContainText('Bee')
  await expect(selected(page).nth(1)).toContainText('See')
  await expect(picker(page).getByRole('textbox', { name: '题目列表文本编辑' })).toHaveCount(0)
  expect(requests.at(-1)?.map(item => [item.platform, item.problemId])).toEqual([['luogu', 'B'], ['carits', 'C']])
  await testInfo.attach('text-list-editor', { body: await page.screenshot(), contentType: 'image/png' })
})

test('text editing keeps row-local failures visible and does not partially replace the list', async ({ page }) => {
  await api(page)
  await page.goto('/personal/training-sessions')
  await picker(page).getByRole('button', { name: '编辑', exact: true }).click()
  const textarea = picker(page).getByRole('textbox', { name: '题目列表文本编辑' })
  await textarea.fill('carits | A | A\ncarits | missing | B')
  await picker(page).getByRole('button', { name: '确认', exact: true }).click()
  await expect(picker(page).getByRole('alert')).toContainText('第 2 行')
  await expect(picker(page)).toContainText('未找到')
  await expect(selected(page)).toHaveCount(0)
})

test('single field rejects URLs and oversized identifiers without sending requests', async ({ page }) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  await beginAdd(page)
  for (const value of ['A B', 'A'.repeat(129), 'https://example.test/problem/A']) {
    await number(page).fill(value)
    await expect(number(page)).toHaveAttribute('aria-invalid', 'true')
    await number(page).press('Enter')
  }
  expect(requests).toHaveLength(0)
})

test('narrow hosts stay within the viewport and text edit is inline, not a nested dialog', async ({ page }) => {
  await api(page)
  await page.goto('/personal/training-sessions')
  await page.locator('#host').evaluate(element => { (element as HTMLElement).style.width = '340px' })
  await beginAdd(page)
  await number(page).fill('A'.repeat(120))
  await expect(picker(page).getByRole('link')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)

  await picker(page).getByRole('button', { name: '取消', exact: true }).click()
  await picker(page).getByRole('button', { name: '编辑', exact: true }).click()
  await expect(picker(page).getByRole('textbox', { name: '题目列表文本编辑' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: /批量添加/ })).toHaveCount(0)
  expect(await page.locator('form form').count()).toBe(0)
})
