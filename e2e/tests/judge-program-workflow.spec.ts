import { expect, test } from '@playwright/test'
import { bearer, loginAs } from '../fixtures/api'
import { accounts } from '../fixtures/auth'

test('judge program editor provides templates and enforces preflight before activation', async ({ browser, request }) => {
  const manager = await loginAs(request, 'platformAdmin')
  const headers = bearer(manager)
  const created = await request.post('/api/problems', { headers, data: { title: 'E2E Judge Program Protocol', description: 'protocol workflow', timeLimit: 1000, memoryLimit: 256, status: 'draft' } })
  expect(created.status()).toBe(201)
  const problemId = String((await created.json()).data.id)

  const context = await browser.newContext({ storageState: accounts.platformAdmin.storageState })
  const page = await context.newPage()
  await page.goto(`/platform-admin/problems/${problemId}/edit`)
  await page.getByRole('button', { name: '评测设置', exact: true }).click()
  await page.getByRole('button', { name: '评测资产与生成', exact: true }).click()
  await expect(page.getByRole('heading', { name: '新增评测程序' })).toBeVisible()
  await page.getByRole('button', { name: /输入校验器 Validator/ }).click()
  await page.getByLabel('程序语言').selectOption('python3')
  await expect(page.getByText('协议：')).toBeVisible()
  await expect(page.getByText('oj.validator/v1', { exact: true })).toBeVisible()
  await expect(page.getByPlaceholder(/选择模板或上传源码/)).toHaveValue(/def reject/)

  const source = `import sys
tokens=sys.stdin.buffer.read().split()
if len(tokens)!=2: raise SystemExit(1)
try: a,b=map(int,tokens)
except ValueError: raise SystemExit(1)
raise SystemExit(0 if -100 <= a <= 100 and -100 <= b <= 100 else 1)
`
  const programResponse = await request.post(`/api/problems/${problemId}/judge-programs`, { headers, data: { kind: 'validator', name: 'Python Validator', language: 'python3', protocol: 'oj.validator/v1', templateId: 'validator-python3-v1', templateVersion: 1, source } })
  expect(programResponse.status()).toBe(201)
  const body = (await programResponse.json()).data
  expect(body.program.currentVersionId).toBeNull()
  expect(body.version.lifecycleStatus).toBe('compiled')

  const earlyActivation = await request.patch(`/api/problems/${problemId}/judge-programs/${body.program.id}`, { headers, data: { currentVersionId: body.version.id } })
  expect(earlyActivation.status()).toBe(409)

  const preflight = await request.post(`/api/problems/${problemId}/judge-programs/${body.program.id}/versions/${body.version.id}/preflight`, { headers, data: { fixtures: [{ name: 'valid', stdin: '1 2\n', expectedExitCode: 0 }, { name: 'invalid-extra', stdin: '1 2 3\n', expectedExitCode: 1 }] } })
  const preflightBody = await preflight.json()
  expect(preflight.status(), JSON.stringify(preflightBody)).toBe(200)
  expect(preflightBody.data.lifecycleStatus).toBe('verified')

  const activation = await request.patch(`/api/problems/${problemId}/judge-programs/${body.program.id}`, { headers, data: { currentVersionId: body.version.id } })
  expect(activation.status()).toBe(200)
  const programs = await request.get(`/api/problems/${problemId}/judge-programs`, { headers })
  const active = (await programs.json()).data.find((item: { id: string }) => item.id === body.program.id)
  expect(active.currentVersionId).toBe(body.version.id)
  expect(active.versions[0]).toMatchObject({ language: 'python3', protocol: 'oj.validator/v1', lifecycleStatus: 'active', templateId: 'validator-python3-v1' })
  await context.close()
})
