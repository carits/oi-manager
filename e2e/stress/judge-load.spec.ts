import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { sessionCookie, loginAs } from '../fixtures/api'

const submissionCount = Number(process.env.E2E_STRESS_SUBMISSIONS || 100)
const roundCount = Number(process.env.E2E_STRESS_ROUNDS || 1)
if (!Number.isInteger(submissionCount) || submissionCount < 1 || submissionCount > 500) {
  throw new Error('E2E_STRESS_SUBMISSIONS must be an integer between 1 and 500')
}
if (!Number.isInteger(roundCount) || roundCount < 1 || roundCount > 60) {
  throw new Error('E2E_STRESS_ROUNDS must be an integer between 1 and 60')
}

const terminalResults = new Set([
  'accepted', 'wa', 'tle', 'mle', 'ole', 're', 'ce', 'pe',
  'system_error', 'judge_failed', 'submit_failed', 'unknown_error',
])

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await work(items[index], index)
    }
  }))
  return results
}

async function sandboxFileCount(port = 15050) {
  const response = await fetch(`http://127.0.0.1:${port}/file`)
  if (!response.ok) throw new Error(`go-judge file inventory returned ${response.status}`)
  return Object.keys(await response.json() as Record<string, string>).length
}

function readRssKb(pid: number) {
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8')
  return Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] || 0)
}

function latencySummary(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  const percentile = (value: number) => sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)] || 0
  return {
    samples: sorted.length,
    min: sorted[0] || 0,
    p50: percentile(0.50),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1) || 0,
  }
}

async function loadSubmissionPages(request: APIRequestContext, headers: Record<string, string>) {
  const pages = Math.ceil((submissionCount + 20) / 100)
  const records: Array<{ id: number; result: string | null; score: number | null }> = []
  for (let page = 1; page <= pages; page++) {
    const response = await request.get(`/api/submissions?problemId=E2E-1000&page=${page}&pageSize=100`, { headers })
    expect(response.status()).toBe(200)
    records.push(...(await response.json()).data.submissions)
  }
  return records
}

test(`real go-judge completes ${roundCount} × ${submissionCount} isolated submissions without leaks or stuck work`, async ({ request }) => {
  test.setTimeout(Math.max(15 * 60_000, roundCount * 3 * 60_000))
  const student = await loginAs(request, 'campusStudent')
  const headers = sessionCookie(student)
  const stack = JSON.parse(fs.readFileSync(path.resolve('test-results/stress/stack-pids.json'), 'utf8')) as {
    apiPid: number
    judgePid: number
    sandboxPort: number
  }
  const baseline = {
    apiRssKb: readRssKb(stack.apiPid),
    judgeRssKb: readRssKb(stack.judgePid),
    sandboxFiles: await sandboxFileCount(stack.sandboxPort),
  }
  expect(baseline.sandboxFiles).toBe(0)

  const startedAt = Date.now()
  const allLatencies: number[] = []
  const roundReports: Array<{
    round: number
    submissions: number
    durationMs: number
    throughputPerSecond: number
    observedEndToEndLatencyMs: ReturnType<typeof latencySummary>
  }> = []
  for (let round = 1; round <= roundCount; round++) {
    const roundStartedAt = Date.now()
    const inputs = Array.from({ length: submissionCount }, (_, index) => index)
    const submitted = await mapLimit(inputs, 10, async (_, index) => {
      const submittedAt = Date.now()
      const response = await request.post('/api/submit', {
        headers,
        data: {
          problemId: 'E2E-1000',
          oj: 'carits',
          language: 'cpp',
          code: `#include <iostream>\nint main(){int a,b;if(std::cin>>a>>b)std::cout<<a+b;constexpr int sample=${round * 1000 + index};(void)sample;return 0;}`,
          submitMethod: 'local',
        },
      })
      const body = await response.json()
      expect(response.status(), JSON.stringify(body)).toBe(200)
      return { id: Number(body.data.submissionId), submittedAt }
    })
    const submissionIds = submitted.map(item => item.id)
    expect(new Set(submissionIds).size).toBe(submissionCount)

    const expectedIds = new Set(submissionIds)
    const submittedAtById = new Map(submitted.map(item => [item.id, item.submittedAt]))
    const completedAtById = new Map<number, number>()
    const completed = new Map<number, { id: number; result: string | null; score: number | null }>()
    await expect.poll(async () => {
      for (const record of await loadSubmissionPages(request, headers)) {
        if (expectedIds.has(record.id) && record.result && terminalResults.has(record.result)) {
          completed.set(record.id, record)
          if (!completedAtById.has(record.id)) completedAtById.set(record.id, Date.now())
        }
      }
      return completed.size
    }, { timeout: 12 * 60_000, intervals: [500, 1_000, 2_000] }).toBe(submissionCount)

    const resultRows = [...completed.values()]
    expect(resultRows.every(item => item.result === 'accepted')).toBe(true)
    expect(resultRows.every(item => item.score === 100)).toBe(true)
    expect((await loadSubmissionPages(request, headers)).filter(item => expectedIds.has(item.id) && !terminalResults.has(item.result || ''))).toHaveLength(0)
    await expect.poll(() => sandboxFileCount(stack.sandboxPort), { timeout: 30_000, intervals: [250, 500, 1_000] }).toBe(0)

    const durationMs = Date.now() - roundStartedAt
    const roundLatencies = submissionIds.map(id => completedAtById.get(id)! - submittedAtById.get(id)!)
    allLatencies.push(...roundLatencies)
    roundReports.push({
      round,
      submissions: submissionCount,
      durationMs,
      throughputPerSecond: Number((submissionCount / (durationMs / 1000)).toFixed(2)),
      observedEndToEndLatencyMs: latencySummary(roundLatencies),
    })
  }

  const durationMs = Date.now() - startedAt
  const final = {
    apiRssKb: readRssKb(stack.apiPid),
    judgeRssKb: readRssKb(stack.judgePid),
    sandboxFiles: await sandboxFileCount(stack.sandboxPort),
  }
  const readiness = await request.get('/api/readiness')
  expect(readiness.status()).toBe(200)

  const report = {
    generatedAt: new Date().toISOString(),
    rounds: roundCount,
    submissionsPerRound: submissionCount,
    submissions: submissionCount * roundCount,
    accepted: submissionCount * roundCount,
    durationMs,
    throughputPerSecond: Number(((submissionCount * roundCount) / (durationMs / 1000)).toFixed(2)),
    observedEndToEndLatencyMs: latencySummary(allLatencies),
    roundReports,
    baseline,
    final,
    rssDeltaKb: {
      api: final.apiRssKb - baseline.apiRssKb,
      judge: final.judgeRssKb - baseline.judgeRssKb,
    },
  }
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`
  const reportDirectory = path.resolve('test-results/stress')
  fs.writeFileSync(path.join(reportDirectory, `judge-load-report-${roundCount}x${submissionCount}.json`), serializedReport)
  fs.writeFileSync(path.join(reportDirectory, 'judge-load-report.json'), serializedReport)
})
