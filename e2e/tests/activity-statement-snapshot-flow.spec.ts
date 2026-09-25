import { expect, test } from '@playwright/test'
import { loginAs } from '../fixtures/api'
import { accounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'

const ids = loadFixtureIds()
const organizationId = `org_${ids.school}`
const headers = (cookie: string) => ({
  Cookie: cookie,
  'X-OI-Organization-ID': organizationId,
})

test('activity statement selection and editing preserve immutable revisions', async ({ request, browser }) => {
  const principal = await loginAs(request, 'principal')
  const student = await loginAs(request, 'campusStudent')
  const principalHeaders = headers(principal.cookie)
  const studentHeaders = headers(student.cookie)
  const managementUrl = `/api/contests/${ids.contest}/statement-management`

  const matrixResponse = await request.get(managementUrl, { headers: principalHeaders })
  expect(matrixResponse.status()).toBe(200)
  const matrix = (await matrixResponse.json()).data
  expect(matrix.problems).toHaveLength(3)

  const selections = matrix.problems.map((problem: any) => {
    const canonical = problem.options.find((option: any) => option.sourceType === 'canonical')
    expect(canonical).toBeTruthy()
    expect(['官方中文', '官方题面']).toContain(canonical.name)
    expect(canonical.name).not.toContain(problem.title)
    return {
      trainingProblemId: problem.trainingProblemId,
      visibleOptionKeys: [canonical.key],
      defaultOptionKey: canonical.key,
    }
  })

  const forbiddenSelection = await request.put(managementUrl, {
    headers: studentHeaders,
    data: { selections },
  })
  expect(forbiddenSelection.status()).toBe(403)

  const selected = await request.put(managementUrl, {
    headers: principalHeaders,
    data: { selections },
  })
  expect(selected.status()).toBe(200)
  expect((await selected.json()).data).toMatchObject({ changedCount: 3 })

  const target = matrix.problems[0]
  const versionsUrl = `/api/contests/${ids.contest}/problems/${target.trainingProblemId}/statement-versions`
  const participantView = await request.get(versionsUrl, { headers: studentHeaders })
  expect(participantView.status()).toBe(200)
  const before = (await participantView.json()).data
  expect(before.selectionRevision).toBe(1)
  expect(before.statements).toHaveLength(1)
  expect(before.statements[0].isDefault).toBe(true)
  const oldSnapshotId = before.statements[0].id as string

  const editUrl = `/api/contests/${ids.contest}/problems/${target.trainingProblemId}/content-snapshots/statement/${oldSnapshotId}`
  const forbiddenEdit = await request.put(editUrl, {
    headers: studentHeaders,
    data: { content: 'student must not change activity snapshots' },
  })
  expect(forbiddenEdit.status()).toBe(403)

  const editedContent = '# E2E activity-only statement\n\nThis content belongs only to the activity snapshot.'
  const edited = await request.put(editUrl, {
    headers: principalHeaders,
    data: { content: editedContent },
  })
  expect(edited.status()).toBe(200)
  expect((await edited.json()).data.revision).toBe(2)

  const afterResponse = await request.get(versionsUrl, { headers: studentHeaders })
  expect(afterResponse.status()).toBe(200)
  const after = (await afterResponse.json()).data
  expect(after.selectionRevision).toBe(2)
  expect(after.statements).toHaveLength(1)
  expect(after.statements[0].content).toBe(editedContent)
  expect(after.statements[0].id).not.toBe(oldSnapshotId)

  const stale = await request.put(editUrl, {
    headers: principalHeaders,
    data: { content: 'stale overwrite' },
  })
  expect(stale.status()).toBe(409)
  expect((await stale.json()).code).toBe('CONTENT_SNAPSHOT_STALE')

  const finalMatrix = await request.get(managementUrl, { headers: principalHeaders })
  expect(finalMatrix.status()).toBe(200)
  const revisions = (await finalMatrix.json()).data.problems.map((problem: any) => problem.selectionRevision)
  expect(revisions).toEqual([2, 1, 1])

  const removedCreation = await request.post(
    `/api/contests/${ids.contest}/problems/${target.trainingProblemId}/statement-versions`,
    { headers: principalHeaders, data: { name: 'forbidden activity creation' } },
  )
  expect(removedCreation.status()).toBe(404)

  const context = await browser.newContext({ storageState: accounts.principal.storageState })
  const page = await context.newPage()
  await page.goto(`/org/${organizationId}/contests/${ids.contest}/statements`)
  await expect(page.getByRole('heading', { name: '题面选择' })).toBeVisible()
  const canonicalRow = page.locator('tbody tr').first()
  await expect(canonicalRow).toContainText(/官方中文|官方题面/)
  await expect(canonicalRow).not.toContainText('E2E A Plus B')
  await expect(page.locator('body')).not.toContainText('正在加载题面矩阵…')
  await context.close()
})
