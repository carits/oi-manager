import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'
import { assertAccessibleState } from '../support/page-audit'

const ids = loadFixtureIds()
const base = `/org/org_${ids.school}/training-sessions/${ids.trainingSession}`

test.describe('coach-directed training engine @smoke @compact', () => {
  test('coach creates a draft and visibly arranges stage and problem order', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const coach = await coachContext.newPage()
    await coach.goto(`/org/org_${ids.school}/training-sessions`)
    await coach.getByRole('button', { name: '创建训练' }).click()
    const dialog = coach.getByRole('dialog', { name: '创建训练' })
    await assertAccessibleState(coach)
    await dialog.getByRole('tab', { name: '使用 Stage 模板' }).click()
    await dialog.getByLabel('训练名称').fill('E2E 顺序编排')
    await dialog.getByRole('button', { name: '创建并编排' }).click()
    await expect(coach).toHaveURL(/\/training-sessions\/[^/]+\/design$/)
    await expect(coach.getByRole('region', { name: '阶段时间线' })).toBeVisible()
    await expect(coach.getByRole('region', { name: '当前阶段题目链' })).toBeVisible()
    const problemInput = coach.getByRole('region', { name: '按题号添加' })
    await expect(problemInput).toBeVisible()
    await problemInput.getByLabel('题目平台').selectOption('carits')
    await problemInput.getByLabel('题号').fill('E2E-1000')
    await problemInput.getByRole('button', { name: '添加' }).click()
    await expect(problemInput.getByText(/E2E A Plus B/)).toBeVisible()
    await expect(coach.getByRole('heading', { name: '完整流程预览' })).toBeVisible()
    await coach.getByRole('button', { name: '保存编排' }).click()
    const savedToast = coach.getByText('编排已保存，题目分配 ID 和固定版本保持稳定')
    await expect(savedToast).toBeVisible()
    await expect(savedToast).toBeHidden({ timeout: 10_000 })
    await coach.reload()
    await expect(coach.getByRole('heading', { name: '完整流程预览' })).toBeVisible()
    await coach.getByRole('button', { name: '3 学员与分组' }).click()
    await expect(coach.getByRole('heading', { name: '学员与分组' })).toBeVisible()
    await coach.getByRole('button', { name: '4 提示配置' }).click()
    await expect(coach.getByRole('heading', { name: '提示配置' })).toBeVisible()
    await coach.getByRole('button', { name: '5 发布检查' }).click()
    await expect(coach.getByRole('heading', { name: '发布检查' })).toBeVisible()
    await coachContext.close()
  })

  test('coach starts, focuses and pauses while student keeps an isolated draft', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const coach = await coachContext.newPage(), student = await studentContext.newPage()

    await coach.goto(base)
    await expect(coach.getByRole('heading', { name: 'E2E 教练训练' })).toBeVisible()
    const start = coach.getByRole('button', { name: '开始', exact: true })
    const resume = coach.getByRole('button', { name: '恢复', exact: true })
    await expect(start.or(resume)).toBeVisible()
    if (await start.isVisible()) await start.click()
    else await resume.click()
    await expect(coach.getByText('进行中', { exact: true })).toBeVisible()

    await student.goto(base)
    await expect(student.getByRole('heading', { name: /A.*E2E A Plus B/ })).toBeVisible()
    const editor = student.getByLabel('代码草稿')
    await editor.fill('#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}')
    await student.getByRole('button', { name: '保存草稿' }).click()
    await expect(student.getByText('草稿已保存')).toBeVisible()

    await expect(coach.getByLabel('教练控制对象')).toHaveValue('ALL')
    await coach.getByRole('button', { name: '聚焦当前题', exact: true }).click()
    await expect(student.getByText('使用训练发布时固定的数据评测', { exact: true })).toBeVisible()
    await coach.getByRole('button', { name: '硬暂停', exact: true }).click()
    await expect(student.getByText('已暂停', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(student.getByRole('button', { name: '提交评测' })).toBeDisabled()
    await expect(student.getByLabel('代码草稿')).toBeDisabled()
    await student.reload()
    await expect(student.getByLabel('代码草稿')).toHaveValue(/std::cout/)

    await coachContext.close(); await studentContext.close()
  })
})
