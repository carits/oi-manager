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
    await expect(navigation.getByRole('link', { name: '评测记录' })).toBeVisible()

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

  test('training list uses the current school role instead of exposing manager actions to students', async ({ browser }) => {
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const studentPage = await studentContext.newPage()
    await studentPage.goto(`${organizationBase}/training-sessions`)
    await expect(studentPage.getByRole('heading', { name: '训练', exact: true })).toBeVisible()
    await expect(studentPage.getByText('查看老师安排的训练并继续练习。')).toBeVisible()
    await expect(studentPage.getByRole('button', { name: '创建训练' })).toHaveCount(0)
    await expect(studentPage.getByRole('tab', { name: /进行中/ })).toBeVisible()
    await expect(studentPage.getByRole('tab', { name: /即将开始/ })).toBeVisible()
    await expect(studentPage.getByRole('tab', { name: /已完成/ })).toBeVisible()
    await expect(studentPage.getByText('教练带练模式')).toHaveCount(0)
    await studentContext.close()

    const teacherContext = await browser.newContext({ storageState: accounts.teacher.storageState })
    const teacherPage = await teacherContext.newPage()
    await teacherPage.goto(`${organizationBase}/training-sessions`)
    await expect(teacherPage.getByText('布置和管理学生练习。')).toBeVisible()
    await expect(teacherPage.getByRole('button', { name: '创建训练' })).toBeVisible()
    await expect(teacherPage.getByRole('tab', { name: /草稿/ })).toBeVisible()
    await expect(teacherPage.getByLabel('筛选团队')).toBeVisible()
    await expect(teacherPage.getByLabel('搜索训练')).toBeVisible()
    await teacherContext.close()
  })

  test('contest creation exposes all five decisions before the final write', async ({ browser }) => {
    const context = await browser.newContext({ storageState: accounts.principal.storageState })
    const page = await context.newPage()
    await page.goto(`${organizationBase}/contests`)
    await page.getByRole('button', { name: '创建比赛' }).click()

    const createDialog = page.getByRole('dialog', { name: '创建比赛' })
    await expect(createDialog.getByRole('button', { name: '1. 基本信息' })).toHaveAttribute('aria-current', 'step')
    await page.getByPlaceholder('比赛名称').fill('五步向导浏览器验收')
    await createDialog.getByRole('button', { name: '下一步' }).click()

    await expect(createDialog.getByLabel('比赛赛制')).toBeVisible()
    await expect(createDialog.getByLabel('Rating 范围')).toHaveValue('NONE')
    await createDialog.getByRole('button', { name: '下一步' }).click()

    await createDialog.getByRole('button', { name: '选择题目' }).click()
    const picker = page.getByRole('dialog', { name: '选择比赛题目' })
    await expect(picker.getByRole('tab', { name: '校内题库' })).toBeVisible()
    await picker.getByRole('button', { name: '加入比赛' }).first().click()
    await picker.getByRole('button', { name: '关闭对话框' }).click()
    await expect(createDialog.locator('[aria-label="已选比赛题目"]')).toBeVisible()
    await createDialog.getByRole('button', { name: '下一步' }).click()

    await expect(createDialog.getByText('题目来源显示')).toBeVisible()
    await expect(createDialog.getByText('题解显示')).toBeVisible()
    await createDialog.getByRole('button', { name: '下一步' }).click()
    await expect(createDialog.getByRole('heading', { name: '发布前检查' })).toBeVisible()
    await expect(createDialog.getByText(/创建时固定各题当前评测数据版本/)).toBeVisible()
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
