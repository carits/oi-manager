import { expect, test, type Page } from '@playwright/test'

const password = process.env.E2E_LIVE_PASSWORD
const organizationId = process.env.E2E_LIVE_ORGANIZATION_ID || 'org_school-default'
const teacherUsername = process.env.E2E_LIVE_PRINCIPAL || 'teacher1'

type RuntimeFailure = {
  source: 'console' | 'page' | 'response'
  message: string
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('用户名').fill(teacherUsername)
  await page.getByLabel('密码').fill(password!)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
}

function watchRuntimeFailures(page: Page) {
  const failures: RuntimeFailure[] = []
  page.on('console', message => {
    if (message.type() === 'error') failures.push({ source: 'console', message: message.text() })
  })
  page.on('pageerror', error => failures.push({ source: 'page', message: error.message }))
  page.on('response', response => {
    if (response.status() >= 500) {
      failures.push({ source: 'response', message: `${response.status()} ${response.url()}` })
    }
  })
  return failures
}

async function assertNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.clientWidth + 1)
}

async function findParticipantRow(page: Page, username: string) {
  await page.getByPlaceholder('搜索姓名或用户名').fill(username)
  const ranking = page.getByTestId('training-ranking-scroll')
  const row = ranking.getByRole('row').filter({ hasText: username })
  await expect(row).toHaveCount(1)
  return row
}

test.beforeAll(() => {
  if (!password) throw new Error('E2E_LIVE_PASSWORD is required for the manual live contest suite')
})

test('20260815 ACM and IOI rankings open the correct submission list and detail modes', async ({ page }) => {
  const failures = watchRuntimeFailures(page)
  await login(page)

  await page.goto(`/org/${organizationId}/contests/1158?tab=ranking`)
  await expect(page.getByRole('heading', { name: '20260815 Real Contest IOI' })).toBeVisible()
  await expect(page.getByText('23 人参赛', { exact: true })).toBeVisible()
  const ioiRow = await findParticipantRow(page, 'oi20260815_07')
  await expect(ioiRow.getByRole('button', { name: 'A：100 分，满分 100 分，点击查看提交记录' })).toBeVisible()
  await expect(ioiRow.getByRole('button', { name: 'B：100 分，满分 100 分，点击查看提交记录' })).toBeVisible()
  await expect(ioiRow.getByRole('button', { name: 'C：0 分，满分 100 分，点击查看提交记录' })).toBeVisible()
  await expect(ioiRow.getByRole('button', { name: 'D：100 分，满分 100 分，点击查看提交记录' })).toBeVisible()
  await ioiRow.getByRole('button', { name: 'A：100 分，满分 100 分，点击查看提交记录' }).click()

  const ioiList = page.getByRole('dialog', { name: /oi20260815_07.*A 题的提交记录/ })
  await expect(ioiList).toBeVisible()
  await expect(ioiList.getByRole('columnheader', { name: '分数' })).toBeVisible()
  await expect(ioiList.getByRole('button', { name: /#3678/ })).toBeVisible()
  await expect(ioiList.getByText('Accepted', { exact: true })).toBeVisible()
  await expect(ioiList.getByRole('cell', { name: '100', exact: true })).toBeVisible()
  await ioiList.getByRole('button', { name: /#3678/ }).click()

  await expect(page.getByRole('dialog')).toHaveCount(2)
  const ioiDetail = page.getByRole('dialog').last()
  await expect(ioiDetail).toContainText('#3678')
  await expect(ioiDetail.getByText('100 / 100', { exact: true })).toBeVisible()
  await expect(ioiDetail.getByText(/Subtask/).first()).toBeVisible()
  await expect(ioiDetail.getByRole('columnheader', { name: '得分' })).toBeVisible()
  expect(await page.locator('[role="dialog"][aria-modal="true"]:visible').count()).toBe(2)
  expect(await page.locator('html').evaluate(element => getComputedStyle(element).overflow)).toBe('hidden')
  expect(await page.locator('body').evaluate(element => getComputedStyle(element).overflow)).toBe('hidden')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(ioiList).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await assertNoPageOverflow(page)

  await page.goto(`/org/${organizationId}/contests/1157?tab=ranking`)
  await expect(page.getByRole('heading', { name: '20260815 Real Contest ACM' })).toBeVisible()
  await expect(page.getByText('23 人参赛', { exact: true })).toBeVisible()
  const acmRow = await findParticipantRow(page, 'oi20260815_07')
  const acmProblemA = acmRow.getByRole('button', { name: /A：已通过.*点击查看提交记录/ })
  await expect(acmProblemA).toBeVisible()
  await acmProblemA.press('Enter')

  const acmList = page.getByRole('dialog', { name: /oi20260815_07.*A 题的提交记录/ })
  await expect(acmList).toBeVisible()
  await expect(acmList.getByRole('columnheader', { name: '分数' })).toHaveCount(0)
  await expect(acmList.getByRole('button', { name: /#3677/ })).toBeVisible()
  await expect(acmList.getByText('Accepted', { exact: true })).toBeVisible()
  await acmList.getByRole('button', { name: /#3677/ }).click()

  const acmDetail = page.getByRole('dialog').last()
  await expect(acmDetail).toContainText('#3677')
  await expect(acmDetail.getByText('Accepted', { exact: true }).first()).toBeVisible()
  await expect(acmDetail.getByText('100 / 100', { exact: true })).toHaveCount(0)
  await expect(acmDetail.getByRole('columnheader', { name: '得分' })).toHaveCount(0)
  await expect(acmDetail.getByRole('columnheader', { name: '状态' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(acmList).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await assertNoPageOverflow(page)

  expect(failures, failures.map(item => `${item.source}: ${item.message}`).join('\n')).toEqual([])
})
