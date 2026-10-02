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

const editor = (page: Page) => page.getByTestId('problem-list-editor')
const selected = (page: Page) => page.getByTestId('selected').locator('li')
const number = (page: Page, index = 1) => editor(page).getByRole('textbox', { name: `第 ${index} 题题号`, exact: true })
const alias = (page: Page, index = 1) => editor(page).getByRole('textbox', { name: `第 ${index} 题别名`, exact: true })
const platform = (page: Page, index = 1) => editor(page).getByLabel(`第 ${index} 题平台`, { exact: true })

async function beginAdd(page: Page) {
  await editor(page).getByRole('button', { name: '＋ 添加一道题目', exact: true }).click()
}

test('adding a row automatically resolves it without search or completion controls', async ({ page }, testInfo) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  await expect(editor(page)).not.toContainText('检索结果')
  await expect(editor(page)).not.toContainText('重新检索')
  await expect(editor(page).getByRole('button', { name: '完成', exact: true })).toHaveCount(0)

  await beginAdd(page)
  await alias(page).fill('Warmup')
  await number(page).fill('A')

  await expect(editor(page).getByRole('link', { name: '题目 carits A', exact: true })).toBeVisible()
  await expect(selected(page)).toHaveCount(1)
  await expect(selected(page)).toContainText('Warmup')
  expect(requests).toHaveLength(1)
  await expect(page.getByTestId('form-submits')).toHaveText('0')
  await testInfo.attach('row-first-problem-entry', { body: await page.screenshot(), contentType: 'image/png' })
})

for (const host of ['训练创建', '训练设计', '训练追加', '比赛', '作业', '题单']) {
  test(`${host}: row editor preserves the host assessment policy`, async ({ page }) => {
    await api(page)
    await page.goto('/personal/training-sessions')
    await page.getByLabel('业务入口', { exact: true }).selectOption(host)
    await beginAdd(page)
    await number(page).fill('A')

    if (host === '比赛' || host === '作业') {
      await expect(editor(page)).toContainText('Stable')
      await expect(selected(page)).toHaveCount(0)
      await number(page).fill('S')
      await expect(editor(page).getByRole('link', { name: '题目 carits S', exact: true })).toBeVisible()
    } else {
      await expect(editor(page).getByRole('link', { name: '题目 carits A', exact: true })).toBeVisible()
    }
    await expect(selected(page)).toHaveCount(1)
  })
}

test('Enter resolves the current row and opens the next row for continuous entry', async ({ page }) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  await beginAdd(page)
  await alias(page).fill('A')
  await number(page).fill('A')
  await number(page).press('Enter')

  await expect(selected(page)).toHaveCount(1)
  await expect(number(page, 2)).toBeVisible()
  expect(requests).toHaveLength(1)
  await expect(page.getByTestId('form-submits')).toHaveText('0')
})

test('alias editing never triggers identity resolution', async ({ page }) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  await beginAdd(page)
  await number(page).fill('A')
  await expect(selected(page)).toHaveCount(1)
  expect(requests).toHaveLength(1)

  await alias(page).fill('新别名')
  await alias(page).blur()
  await expect(selected(page)).toContainText('新别名')
  expect(requests).toHaveLength(1)
})

test('composition does not resolve unfinished problem numbers', async ({ page }) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  await beginAdd(page)
  await number(page).focus()
  await number(page).evaluate(element => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, 'A')
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'A', inputType: 'insertCompositionText', isComposing: true }))
  })
  await page.waitForTimeout(500)
  expect(requests).toHaveLength(0)
  await number(page).evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'A' })))
  await expect(editor(page).getByRole('link', { name: '题目 carits A', exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)
})

test('a stale response cannot overwrite a newer platform or number', async ({ page }) => {
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
  await platform(page).selectOption('luogu')
  await number(page).fill('P0001')
  await expect(editor(page).getByRole('link', { name: '题目 luogu P0001', exact: true })).toBeVisible()
  release?.()
  await page.waitForTimeout(100)
  await expect(editor(page).getByRole('link', { name: '题目 carits 001', exact: true })).toHaveCount(0)
  await expect(selected(page)).toContainText('P0001')
})

test('unpublished problems keep the row editable without exposing title or internal link', async ({ page }) => {
  await api(page)
  await page.goto('/personal/training-sessions')
  await beginAdd(page)
  await number(page).fill('draft')
  await expect(editor(page)).toContainText('尚未发布')
  await expect(editor(page).getByRole('link')).toHaveCount(0)
  await expect(editor(page)).not.toContainText('题目 carits draft')
  await expect(page.getByTestId('blocked')).toHaveText('true')
  await expect(selected(page)).toHaveCount(0)

  await number(page).fill('A')
  await expect(editor(page).getByRole('link', { name: '题目 carits A', exact: true })).toBeVisible()
  await expect(page.getByTestId('blocked')).toHaveText('false')
})

test('business failure keeps the resolved row and can be retried by editing alias', async ({ page }) => {
  await api(page)
  await page.goto('/personal/training-sessions')
  await page.getByLabel('接收模式').selectOption('error')
  await beginAdd(page)
  await number(page).fill('A')
  await expect(editor(page).getByRole('alert')).toContainText('业务暂时不可用')
  await expect(selected(page)).toHaveCount(0)

  await page.getByLabel('接收模式').selectOption('all')
  await alias(page).fill('Retry')
  await alias(page).blur()
  await expect(selected(page)).toHaveCount(1)
  await expect(selected(page)).toContainText('Retry')
})

test('Edit replaces the list in-place and preserves aliases', async ({ page }, testInfo) => {
  const requests = await api(page)
  await page.goto('/personal/training-sessions')
  await beginAdd(page)
  await alias(page).fill('A')
  await number(page).fill('A')
  await expect(selected(page)).toHaveCount(1)

  await editor(page).getByRole('button', { name: '编辑', exact: true }).click()
  const textarea = editor(page).getByRole('textbox', { name: '题目列表文本编辑' })
  await expect(textarea).toHaveValue('carits | A | A')
  await textarea.fill('luogu | B | Bee\ncarits | C | See')
  await editor(page).getByRole('button', { name: '确认', exact: true }).click()

  await expect(selected(page)).toHaveCount(2)
  await expect(selected(page).nth(0)).toContainText('Bee')
  await expect(selected(page).nth(1)).toContainText('See')
  await expect(textarea).toHaveCount(0)
  expect(requests.at(-1)?.map(item => [item.platform, item.problemId])).toEqual([['luogu', 'B'], ['carits', 'C']])
  await testInfo.attach('text-list-editor', { body: await page.screenshot(), contentType: 'image/png' })
})

test('text editing accepts valid rows and leaves identity failures visible in the list', async ({ page }) => {
  await api(page)
  await page.goto('/personal/training-sessions')
  await editor(page).getByRole('button', { name: '编辑', exact: true }).click()
  const textarea = editor(page).getByRole('textbox', { name: '题目列表文本编辑' })
  await textarea.fill('carits | A | A\ncarits | missing | B')
  await editor(page).getByRole('button', { name: '确认', exact: true }).click()

  await expect(textarea).toHaveCount(0)
  await expect(selected(page)).toHaveCount(1)
  await expect(selected(page)).toContainText('A')
  await expect(editor(page)).toContainText('未找到')
  await expect(page.getByTestId('blocked')).toHaveText('true')
})

test('malformed text remains in text mode for correction', async ({ page }) => {
  await api(page)
  await page.goto('/personal/training-sessions')
  await editor(page).getByRole('button', { name: '编辑', exact: true }).click()
  const textarea = editor(page).getByRole('textbox', { name: '题目列表文本编辑' })
  await textarea.fill('只有平台')
  await editor(page).getByRole('button', { name: '确认', exact: true }).click()
  await expect(textarea).toBeVisible()
  await expect(editor(page).getByRole('alert')).toContainText('第 1 行')
})

test('narrow hosts stay within the viewport and text edit remains inline', async ({ page }) => {
  await api(page)
  await page.goto('/personal/training-sessions')
  await page.locator('#host').evaluate(element => { (element as HTMLElement).style.width = '340px' })
  await beginAdd(page)
  await number(page).fill('A')
  await expect(editor(page).getByRole('link')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)

  await editor(page).getByRole('button', { name: '编辑', exact: true }).click()
  await expect(editor(page).getByRole('textbox', { name: '题目列表文本编辑' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: /批量添加/ })).toHaveCount(0)
  expect(await page.locator('form form').count()).toBe(0)
})
