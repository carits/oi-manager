import { expect, test } from '@playwright/test'
import { bearer, loginAs } from '../fixtures/api'
import { loadFixtureIds } from '../fixtures/data'

const ids = loadFixtureIds()
const problemId = 'e2e-contest-problem-b'
const organizationHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'X-OI-Organization-ID': `org_${ids.school}`,
})

test('contest rejudge is scoped, skips active work and excludes archives', async ({ request }) => {
  const principal = await loginAs(request, 'principal')
  const student = await loginAs(request, 'campusStudent')
  const principalHeaders = organizationHeaders(principal.token)
  const studentHeaders = organizationHeaders(student.token)
  const previewUrl = `/api/trainings/${ids.contest}/rejudge/preview?scopeType=problem&trainingProblemId=${problemId}`

  const before = await request.get(previewUrl, { headers: principalHeaders })
  expect(before.status()).toBe(200)
  expect((await before.json()).data).toEqual({ matchedCount: 3, inProgressCount: 0 })

  const forbidden = await request.post(`/api/trainings/${ids.contest}/rejudge`, {
    headers: studentHeaders,
    data: { scope: { type: 'problem', trainingProblemId: problemId } },
  })
  expect(forbidden.status()).toBe(403)

  const rejudge = await request.post(`/api/trainings/${ids.contest}/rejudge`, {
    headers: principalHeaders,
    data: { scope: { type: 'problem', trainingProblemId: problemId } },
  })
  expect(rejudge.status()).toBe(200)
  expect((await rejudge.json()).data).toMatchObject({ resetCount: 3, skippedCount: 0, scope: 'problem' })

  const after = await request.get(previewUrl, { headers: principalHeaders })
  expect(after.status()).toBe(200)
  expect((await after.json()).data).toEqual({ matchedCount: 0, inProgressCount: 3 })

  const repeated = await request.post(`/api/trainings/${ids.contest}/rejudge`, {
    headers: principalHeaders,
    data: { scope: { type: 'problem', trainingProblemId: problemId } },
  })
  expect(repeated.status()).toBe(200)
  expect((await repeated.json()).data).toMatchObject({ resetCount: 0, skippedCount: 3 })

  const records = await request.get(`/api/trainings/${ids.contest}/submissions?problemId=${problemId}&pageSize=50`, {
    headers: principalHeaders,
  })
  expect(records.status()).toBe(200)
  const submissions = (await records.json()).data.submissions as Array<{ oj: string; result: string }>
  expect(submissions).toHaveLength(4)
  expect(submissions.filter(item => item.oj === 'carits').map(item => item.result)).toEqual([
    'queuing',
    'queuing',
    'queuing',
  ])
  expect(submissions.find(item => item.oj === 'codeforces')?.result).toBe('accepted')

  const otherProblem = await request.get(`/api/trainings/${ids.contest}/submissions?problemId=e2e-contest-problem&pageSize=50`, {
    headers: principalHeaders,
  })
  expect(otherProblem.status()).toBe(200)
  expect((await otherProblem.json()).data.submissions.every((item: { result: string }) => item.result === 'accepted')).toBe(true)
})
