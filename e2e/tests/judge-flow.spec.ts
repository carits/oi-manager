import { expect, test } from '@playwright/test'
import { bearer, loginAs } from '../fixtures/api'
import { loadRuntimeSecrets } from '../fixtures/runtime'

const { judgeToken } = loadRuntimeSecrets()

test('two simulated judges claim one task once and complete it', async ({ page, request }) => {
  const student = await loginAs(request, 'campusStudent')
  const submit = await request.post('/api/submit', {
    headers: bearer(student),
    data: {
      problemId: 'E2E-1000',
      oj: 'carits',
      language: 'cpp',
      code: '#include <iostream>\nint main(){std::cout << 2;}',
      submitMethod: 'robot',
    },
  })
  expect(submit.status()).toBe(200)
  const submitted = await submit.json()
  expect(submitted.success).toBe(true)
  const submissionId = String(submitted.data.submissionId)

  await page.goto('/login')
  const result = await page.evaluate(
    ({ expectedSubmissionId, token }) =>
      new Promise<{ assignments: string[]; pongJudges: string[] }>((resolve, reject) => {
        const assignments: string[] = []
        const pongJudges: string[] = []
        const sockets: WebSocket[] = []
        let finishTimer: number | undefined
        const timeout = window.setTimeout(() => {
          sockets.forEach(socket => socket.close())
          reject(new Error(`Timed out waiting for judge task; assignments=${assignments.join(',')}`))
        }, 15_000)

        const finish = () => {
          if (!assignments.length || !pongJudges.length || finishTimer) return
          finishTimer = window.setTimeout(() => {
            window.clearTimeout(timeout)
            sockets.forEach(socket => socket.close())
            resolve({ assignments, pongJudges })
          }, 1_500)
        }

        for (const judgeId of ['e2e-judge-a', 'e2e-judge-b']) {
          const socket = new WebSocket('ws://127.0.0.1:3102/ws/judge')
          sockets.push(socket)
          socket.addEventListener('open', () => {
            socket.send(JSON.stringify({ type: 'auth', payload: { token } }))
          })
          socket.addEventListener('message', event => {
            const message = JSON.parse(String(event.data))
            if (message.type === 'auth_success') {
              socket.send(JSON.stringify({
                type: 'register',
                payload: { judgeId, languages: ['cpp'] },
              }))
            } else if (message.type === 'registered') {
              socket.send(JSON.stringify({ type: 'start', payload: { judgeId, concurrency: 1 } }))
            } else if (message.type === 'started') {
              socket.send(JSON.stringify({ type: 'ping' }))
            } else if (message.type === 'pong') {
              pongJudges.push(judgeId)
              finish()
            } else if (message.type === 'judge') {
              const assignedId = String(message.payload.submissionId)
              if (assignedId !== expectedSubmissionId) {
                reject(new Error(`Unexpected submission ${assignedId}`))
                return
              }
              assignments.push(assignedId)
              socket.send(JSON.stringify({
                type: 'result',
                payload: {
                  submissionId: message.payload.submissionId,
                  result: 'accepted',
                  time: 1,
                  memory: 1024,
                  score: 100,
                  cases: [{ status: 'accepted', time: 1, memory: 1024 }],
                },
              }))
              finish()
            } else if (message.type === 'error') {
              reject(new Error(message.payload?.message || 'Judge WebSocket error'))
            }
          })
          socket.addEventListener('error', () => reject(new Error(`${judgeId} socket failed`)))
        }
      }),
    {
      expectedSubmissionId: submissionId,
      token: judgeToken,
    },
  )

  expect(result.assignments).toEqual([submissionId])
  expect(result.pongJudges.length).toBeGreaterThan(0)

  await expect.poll(async () => {
    const response = await request.get(`/api/submissions/${submissionId}`, {
      headers: bearer(student),
    })
    if (!response.ok()) return `http-${response.status()}`
    const body = await response.json()
    return body.data?.result
  }).toBe('accepted')
})

test('judge WebSocket rejects an invalid token', async ({ page }) => {
  await page.goto('/login')
  const message = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const socket = new WebSocket('ws://127.0.0.1:3102/ws/judge')
        const timeout = window.setTimeout(() => reject(new Error('No auth rejection received')), 5_000)
        socket.addEventListener('open', () => {
          socket.send(JSON.stringify({ type: 'auth', payload: { token: 'wrong-token' } }))
        })
        socket.addEventListener('message', event => {
          const payload = JSON.parse(String(event.data))
          if (payload.type === 'error') {
            window.clearTimeout(timeout)
            resolve(payload.payload?.message || '')
            socket.close()
          }
        })
      }),
  )

  expect(message).toMatch(/invalid token/i)
})
