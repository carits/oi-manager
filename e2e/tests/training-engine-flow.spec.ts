import { expect, test } from '@playwright/test'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'

const ids = loadFixtureIds()
const base = `/org/org_${ids.school}/training-sessions/${ids.trainingSession}`

test.describe('coach-directed training engine @smoke', () => {
  test('coach starts, focuses and pauses while student keeps an isolated draft', async ({ browser }) => {
    const coachContext = await browser.newContext({ storageState: accounts.principal.storageState })
    const studentContext = await browser.newContext({ storageState: accounts.campusStudent.storageState })
    const coach = await coachContext.newPage(), student = await studentContext.newPage()

    await coach.goto(base)
    await expect(coach.getByRole('heading', { name: 'E2E 教练训练' })).toBeVisible()
    await expect(coach.getByRole('button', { name: '开始', exact: true })).toBeVisible()
    await coach.getByRole('button', { name: '开始', exact: true }).click()
    await expect(coach.getByText('RUNNING', { exact: true })).toBeVisible()

    await student.goto(base)
    await expect(student.getByRole('heading', { name: /E2E-1000.*E2E A Plus B/ })).toBeVisible()
    const editor = student.getByLabel('代码草稿')
    await editor.fill('#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}')
    await student.getByRole('button', { name: '保存草稿' }).click()
    await expect(student.getByText('草稿已保存')).toBeVisible()

    await coach.getByRole('button', { name: '全员聚焦当前题' }).click()
    await expect(student.getByText(/固定测试版本 R1/)).toBeVisible()
    await coach.getByRole('button', { name: '暂停' }).click()
    await expect(student.getByText('PAUSED', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(student.getByRole('button', { name: '提交评测' })).toBeDisabled()
    await student.reload()
    await expect(student.getByLabel('代码草稿')).toHaveValue(/std::cout/)

    await coachContext.close(); await studentContext.close()
  })
})
