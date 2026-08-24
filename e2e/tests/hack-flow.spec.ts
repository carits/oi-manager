import { expect, test } from '@playwright/test'
import { bearer, loginAs } from '../fixtures/api'
import { loadFixtureIds } from '../fixtures/data'
import { loadRuntimeSecrets } from '../fixtures/runtime'

const ids = loadFixtureIds()
const { judgeToken } = loadRuntimeSecrets()
test('accepted problem Hack is persisted without changing historical submissions', async ({ page, request }) => {
  const manager = await loginAs(request, 'platformAdmin')
  const hacker = await loginAs(request, 'personalStudent')
  const managerHeaders = bearer(manager)
  const hackerHeaders = bearer(hacker)

  const beforeList = await request.get(`/api/submissions?problemId=E2E-1000&pageSize=50`, {
    headers: managerHeaders,
  })
  expect(beforeList.status()).toBe(200)
  const beforeTotal = (await beforeList.json()).data.total as number

  const configure = await request.put(`/api/problems/${ids.problem}/hack-config`, {
    headers: managerHeaders,
    data: {
      enabled: true,
      standardSource: '#include <iostream>\nint main(){int a,b;if(std::cin>>a>>b)std::cout<<a+b<<"\\n";}',
      validatorSource: '#include <iostream>\nint main(){long long a,b;return (std::cin>>a>>b)?0:1;}',
    },
    timeout: 150_000,
  })
  expect(configure.status()).toBe(200)
  expect((await configure.json()).data.enabled).toBe(true)

  const create = await request.post(`/api/problems/${ids.problem}/hacks`, {
    headers: hackerHeaders,
    data: {
      inputMode: 'data',
      inputData: '2 2\n',
      hackLanguage: 'cpp17',
      hackSource: '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;if(a==2&&b==2)std::cout<<0;else std::cout<<a+b;}',
    },
  })
  expect(create.status()).toBe(202)
  const attemptId = String((await create.json()).data.id)

  await page.goto('/login')
  const dispatchedId = await page.evaluate(
    ({ expectedAttemptId, token }) => new Promise<string>((resolve, reject) => {
      const socket = new WebSocket('ws://127.0.0.1:3102/ws/judge')
      const timeout = window.setTimeout(() => {
        socket.close()
        reject(new Error('Timed out waiting for the Hack task'))
      }, 15_000)
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'auth', payload: { token } }))
      })
      socket.addEventListener('message', event => {
        const message = JSON.parse(String(event.data))
        if (message.type === 'auth_success') {
          socket.send(JSON.stringify({
            type: 'register',
            payload: { judgeId: 'e2e-hack-judge', languages: ['cpp17'] },
          }))
        } else if (message.type === 'registered') {
          socket.send(JSON.stringify({ type: 'start', payload: { judgeId: 'e2e-hack-judge', concurrency: 1 } }))
        } else if (message.type === 'hack') {
          const receivedId = String(message.payload.hackAttemptId)
          if (receivedId !== expectedAttemptId) {
            reject(new Error(`Unexpected Hack attempt ${receivedId}`))
            return
          }
          socket.send(JSON.stringify({
            type: 'hack_result',
            payload: {
              hackAttemptId: receivedId,
              outcome: 'accepted',
              baselineResult: 'Accepted',
              candidateResult: 'Wrong Answer',
              message: 'Accepted → Wrong Answer',
              inputData: '2 2\n',
              outputData: '4\n',
            },
          }))
          window.clearTimeout(timeout)
          socket.close()
          resolve(receivedId)
        } else if (message.type === 'error') {
          reject(new Error(message.payload?.message || 'Judge WebSocket error'))
        }
      })
      socket.addEventListener('error', () => reject(new Error('Hack judge socket failed')))
    }),
    { expectedAttemptId: attemptId, token: judgeToken },
  )
  expect(dispatchedId).toBe(attemptId)

  await expect.poll(async () => {
    const response = await request.get(`/api/problems/${ids.problem}/hacks/${attemptId}`, {
      headers: hackerHeaders,
    })
    if (!response.ok()) return `http-${response.status()}`
    return (await response.json()).data.status
  }).toBe('accepted')

  const detail = await request.get(`/api/problems/${ids.problem}/hacks/${attemptId}`, {
    headers: hackerHeaders,
  })
  const attempt = (await detail.json()).data
  expect(attempt).toMatchObject({
    baselineResult: 'Accepted',
    candidateResult: 'Wrong Answer',
    acceptedInputFile: `hack_${attemptId}.in`,
  })

  const judgeConfig = await request.get(`/api/problems/${ids.problem}/judge-config`, {
    headers: managerHeaders,
  })
  expect(judgeConfig.status()).toBe(200)
  const cases = (await judgeConfig.json()).data.config.cases as Array<{ input: string }>
  expect(cases.map(item => item.input)).toEqual([`hack_${attemptId}.in`, '1.in'])

  const afterList = await request.get(`/api/submissions?problemId=E2E-1000&pageSize=50`, {
    headers: managerHeaders,
  })
  expect(afterList.status()).toBe(200)
  const afterBody = await afterList.json()
  expect(afterBody.data.total).toBe(beforeTotal)
  expect(afterBody.data.submissions.every((item: { result: string }) => item.result !== 'queuing' && item.result !== 'judging')).toBe(true)
})
