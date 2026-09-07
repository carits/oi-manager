import { expect, test } from '@playwright/test'
import { bearer, loginAs } from '../fixtures/api'
import { accounts } from '../fixtures/auth'
import { ensureInitialTestSetRevision, transitionJudgeMode } from '../../apps/server/src/modules/problem/problem.testset-revision.service'
import { prisma } from '../../apps/server/src/prisma'

test('judge program workspace exposes complete templates and blocks unknown Classifier subtasks @compact', async ({ browser, request }) => {
  const manager = await loginAs(request, 'platformAdmin')
  const headers = bearer(manager)
  const created = await request.post('/api/problems', {
    headers,
    data: {
      title: 'E2E Judge Program Template Gallery',
      description: 'Template gallery and Classifier fixture workflow.',
      timeLimit: 1000,
      memoryLimit: 256,
      status: 'draft',
    },
  })
  expect(created.status()).toBe(201)
  const problemId = String((await created.json()).data.id)
  await prisma.problem.update({
    where: { id: problemId },
    data: { judgeConfig: 'mode: acm\ntime_limit: 1000\nmemory_limit: 262144\nchecker_type: default\ncases: []\n' },
  })
  const initialRevision = await ensureInitialTestSetRevision(problemId, manager.userId)
  expect(initialRevision).toBeTruthy()
  await transitionJudgeMode({
    problemId,
    targetMode: 'oi',
    expectedLatestRevisionId: initialRevision!.id,
    updatedBy: manager.userId,
  })

  const context = await browser.newContext({ storageState: accounts.platformAdmin.storageState })
  const page = await context.newPage()
  await page.goto(`/platform-admin/problems/${problemId}/edit`)
  await page.getByRole('button', { name: '评测设置', exact: true }).click()
  await page.getByRole('button', { name: '评测资产与生成', exact: true }).click()

  await expect(page.getByRole('heading', { name: '内置模板与完整示例' })).toBeVisible()
  for (const label of ['标准程序 STD 示例', '输入校验器 Validator 示例', '子任务分类器 Classifier 示例', '数据生成器 Generator 示例']) {
    await expect(page.getByRole('tab', { name: label })).toBeVisible()
  }

  await page.getByRole('tab', { name: '子任务分类器 Classifier 示例' }).click()
  const classifierCard = page.locator('article').filter({ hasText: 'C++17 子任务分类器' }).first()
  await expect(classifierCard).toContainText('3 个 Fixture')
  await classifierCard.getByRole('button', { name: '查看完整示例' }).click()

  const preview = page.getByRole('dialog', { name: /C\+\+17 子任务分类器 · 完整示例/ })
  await expect(preview).toBeVisible()
  await expect(preview.getByText('当前题目 Subtask：1（100 分）', { exact: true })).toBeVisible()
  await expect(preview.getByText('Subtask 1（100 分）', { exact: true })).toBeVisible()
  await expect(preview.getByText(/不存在的 Subtask：2, 3/)).toBeVisible()
  await expect(preview.getByText(/"subtasks"/).first()).toBeVisible()
  await preview.getByRole('button', { name: '使用此模板' }).click()

  const wizard = page.getByRole('dialog', { name: '新增评测程序' })
  await expect(wizard.getByRole('heading', { name: '选择模板或空白开始' })).toBeVisible()
  await wizard.getByRole('button', { name: /下一步/ }).click()
  await expect(wizard.getByText('正在使用：C++17 子任务分类器 v2')).toBeVisible()
  await expect(wizard.getByText('这是教学示例，必须按当前题目修改。')).toBeVisible()
  await expect(wizard.getByLabel('模板源码示例（可修改）')).toContainText('"subtasks"')
  await expect(wizard.getByText('当前题目 Subtask：1（100 分）', { exact: true })).toBeVisible()
  await expect(wizard.getByText('Subtask 1（100 分）', { exact: true })).toBeVisible()

  await wizard.getByRole('button', { name: /下一步/ }).click()
  await expect(wizard.getByText(/以下 Subtask 不属于当前题目：2, 3/)).toBeVisible()
  await expect(wizard.getByText('模板示例')).toHaveCount(3)
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll')

  await context.close()
})
