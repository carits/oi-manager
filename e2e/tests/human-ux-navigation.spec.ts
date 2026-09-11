import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'

const organizationBase = '/org/org_school-default'

test.describe('Human UX navigation foundation @smoke @compact', () => {
  test('desktop opens the grouped navigation and keeps a compact rail after collapse', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.teacher.storageState })
    const page = await context.newPage()
    await page.goto(`${organizationBase}/overview`)

    const navigation = page.getByRole('navigation', { name: '教师主导航' })
    await expect(navigation).toBeVisible()
    await expect(page.locator('[data-navigation-mode="expanded"]')).toBeVisible()
    for (const group of ['教学', '学生与团队', '学校', '社区']) await expect(navigation.getByText(group, { exact: true })).toBeVisible()
    await expect(navigation.getByRole('link', { name: '首页' })).toHaveAttribute('aria-current', 'page')

    await page.getByRole('button', { name: '收起导航' }).first().click()
    await expect(page.locator('[data-navigation-mode="compact"]')).toBeVisible()
    await expect(navigation).toBeVisible()
    await expect(navigation.getByRole('link', { name: '作业' })).toBeVisible()
    await page.reload()
    await expect(page.locator('[data-navigation-mode="compact"]')).toBeVisible()
    await context.close()
  })

  test('student receives direct home and submission entries', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const page = await context.newPage()
    await page.goto(`${organizationBase}/overview`)
    const navigation = page.getByRole('navigation', { name: '学生主导航' })
    await expect(navigation.getByRole('link', { name: '首页' })).toBeVisible()
    await navigation.getByRole('link', { name: '评测记录' }).click()
    await expect(page).toHaveURL(`${organizationBase}/submissions`)
    await expect(page.getByRole('heading', { name: '评测记录' })).toBeVisible()
    await context.close()
  })

  test('unknown and forbidden organization routes explain the problem without changing location', async ({ browser }) => {
    const teacherContext = await browser.newContext({ storageState: accounts.teacher.storageState })
    const teacherPage = await teacherContext.newPage()
    await teacherPage.goto(`${organizationBase}/definitely-missing`)
    await expect(teacherPage).toHaveURL(`${organizationBase}/definitely-missing`)
    await expect(teacherPage.getByRole('heading', { name: '这里没有这个学校页面' })).toBeVisible()
    await teacherContext.close()

    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const studentPage = await studentContext.newPage()
    await studentPage.goto(`${organizationBase}/management`)
    await expect(studentPage).toHaveURL(`${organizationBase}/management`)
    await expect(studentPage.getByRole('heading', { name: '无法访问该页面' })).toBeVisible()
    await expect(studentPage.getByText(/学生身份/)).toBeVisible()
    await studentContext.close()
  })
})
