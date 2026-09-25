import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.BENCHMARK_BASE_URL || 'http://127.0.0.1:3002'
const username = process.env.BENCHMARK_USERNAME
const password = process.env.BENCHMARK_PASSWORD
const organizationId = process.env.BENCHMARK_ORGANIZATION_ID || 'org_school-default'
const rounds = Number(process.env.BENCHMARK_ROUNDS || 3)
const contests = [
  { id: 1157, mode: 'acm' },
  { id: 1158, mode: 'ioi' },
]
const terminalResults = new Set([
  'accepted', 'wa', 'tle', 'mle', 're', 'ce', 'pe', 'ole', 'system_error',
  'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded',
  'runtime_error', 'compile_error', 'presentation_error', 'output_limit_exceeded',
])

if (!username || !password) throw new Error('BENCHMARK_USERNAME and BENCHMARK_PASSWORD are required')
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error('BENCHMARK_ROUNDS must be between 1 and 10')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const normalizeResult = value => String(value || '').trim().toLowerCase().replaceAll(' ', '_')
const percentile = (values, p) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
}
const stats = values => ({
  count: values.length,
  min: values.length ? Math.min(...values) : null,
  median: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  max: values.length ? Math.max(...values) : null,
  mean: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
})

let cookie = ''
async function request(urlPath, options = {}) {
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${urlPath}`, {
        ...options,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-oi-organization-id': organizationId,
          ...(cookie ? { cookie } : {}),
          ...(options.headers || {}),
        },
      })
      const body = await response.json().catch(() => null)
      if (response.ok && body?.success !== false) return body?.data ?? body
      lastError = new Error(`${options.method || 'GET'} ${urlPath}: ${response.status} ${body?.message || response.statusText}`)
      if (![429, 502, 503, 504].includes(response.status)) throw lastError
    } catch (error) {
      lastError = error
      if (attempt === 4) throw error
    }
    await sleep(250 * (2 ** attempt))
  }
  throw lastError
}

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.success === false) throw new Error(`Login failed: ${response.status} ${body?.message || ''}`)
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('Login response did not set a session cookie')
  cookie = setCookie.split(';', 1)[0]
}

async function listSubmissions(contestId) {
  const first = await request(`/api/contests/${contestId}/submissions?page=1&pageSize=100`)
  const rows = [...(first.submissions || [])]
  for (let page = 2; page <= Number(first.totalPages || 1); page += 1) {
    const next = await request(`/api/contests/${contestId}/submissions?page=${page}&pageSize=100`)
    rows.push(...(next.submissions || []))
  }
  return rows
}

async function mapLimit(items, limit, task) {
  const output = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      output[index] = await task(items[index], index)
    }
  }))
  return output
}

function caseMetrics(cases) {
  const executed = (Array.isArray(cases) ? cases : []).filter(item => normalizeResult(item?.result) !== 'skipped')
  const cpu = executed.map(item => Number(item?.cpuTime ?? item?.time ?? 0)).filter(Number.isFinite)
  const wall = executed.map(item => Number(item?.wallTime ?? item?.time ?? 0)).filter(Number.isFinite)
  return {
    executedCases: executed.length,
    caseCpuSumMs: Math.round(cpu.reduce((sum, value) => sum + value, 0)),
    caseWallSumMs: Math.round(wall.reduce((sum, value) => sum + value, 0)),
    maxCaseCpuMs: cpu.length ? Math.max(...cpu) : 0,
    maxCaseWallMs: wall.length ? Math.max(...wall) : 0,
  }
}

async function collectDetails(contest, rows, observedCompletionMs) {
  return mapLimit(rows, 8, async row => {
    const detail = await request(`/api/contests/${contest.id}/submissions/${row.id}`)
    const codeHash = detail.code == null ? null : crypto.createHash('sha256').update(detail.code).digest('hex')
    return {
      contestId: contest.id,
      mode: contest.mode,
      submissionId: row.id,
      userId: row.userId,
      username: row.username,
      problemOrderIndex: row.problemOrderIndex,
      problemAlias: row.problemAlias,
      codeHash,
      result: normalizeResult(detail.result),
      score: detail.score,
      timeUsedMs: detail.timeUsed,
      wallTimeUsedMs: detail.wallTimeUsed,
      memoryUsedKb: detail.memoryUsed,
      observedCompletionMs: observedCompletionMs.get(row.id) ?? null,
      ...caseMetrics(detail.cases),
    }
  })
}

function buildPairs(records) {
  const byMode = new Map()
  for (const record of records) {
    if (!record.codeHash) continue
    const key = `${record.username}|${record.problemOrderIndex}|${record.codeHash}`
    byMode.set(`${record.mode}|${key}`, record)
  }
  const pairs = []
  for (const [lookup, acm] of byMode) {
    if (!lookup.startsWith('acm|')) continue
    const key = lookup.slice(4)
    const ioi = byMode.get(`ioi|${key}`)
    if (!ioi) continue
    pairs.push({ key, username: acm.username, problemOrderIndex: acm.problemOrderIndex, problemAlias: acm.problemAlias, acm, ioi })
  }
  return pairs.sort((a, b) => a.problemOrderIndex - b.problemOrderIndex || a.username.localeCompare(b.username))
}

function summarizeRound(round, elapsedMs, rejudge, records) {
  const pairs = buildPairs(records)
  const byMode = Object.fromEntries(['acm', 'ioi'].map(mode => {
    const selected = records.filter(record => record.mode === mode)
    return [mode, {
      submissions: selected.length,
      observedCompletionMs: stats(selected.map(record => record.observedCompletionMs).filter(Number.isFinite)),
      caseWallSumMs: stats(selected.map(record => record.caseWallSumMs)),
      caseCpuSumMs: stats(selected.map(record => record.caseCpuSumMs)),
      maxCaseWallMs: stats(selected.map(record => record.maxCaseWallMs)),
    }]
  }))
  const inconsistencies = pairs.filter(({ acm, ioi }) =>
    (acm.result === 'accepted') !== (ioi.result === 'accepted' && Number(ioi.score) === 100))
  return {
    round,
    elapsedMs,
    rejudge,
    records,
    pairs,
    summary: {
      pairCount: pairs.length,
      resultInconsistencyCount: inconsistencies.length,
      resultInconsistencies: inconsistencies.map(pair => ({
        username: pair.username,
        problemOrderIndex: pair.problemOrderIndex,
        acmSubmissionId: pair.acm.submissionId,
        acmResult: pair.acm.result,
        ioiSubmissionId: pair.ioi.submissionId,
        ioiResult: pair.ioi.result,
        ioiScore: pair.ioi.score,
      })),
      byMode,
      acceptedPairWallRatio: stats(pairs
        .filter(pair => pair.acm.result === 'accepted' && pair.ioi.result === 'accepted' && pair.acm.caseWallSumMs > 0)
        .map(pair => Math.round(pair.ioi.caseWallSumMs * 1000 / pair.acm.caseWallSumMs))),
    },
  }
}

await login()
const contestInfo = await Promise.all(contests.map(async contest => ({ ...contest, data: await request(`/api/contests/${contest.id}`) })))
if (process.env.BENCHMARK_INSPECT_ONLY === '1') {
  const lists = await Promise.all(contests.map(async contest => ({ contest, rows: await listSubmissions(contest.id) })))
  const records = (await Promise.all(lists.map(item => collectDetails(item.contest, item.rows, new Map())))).flat()
  const inspected = summarizeRound(0, 0, [], records)
  const target = inspected.pairs.find(pair => pair.username === 'oi20260815_07' && pair.problemOrderIndex === 0)
  console.log(JSON.stringify({ summary: inspected.summary, target, resultCounts: Object.fromEntries(['acm', 'ioi'].map(mode => [mode, records.filter(record => record.mode === mode).reduce((counts, record) => ({ ...counts, [record.result]: (counts[record.result] || 0) + 1 }), {})])) }, null, 2))
  process.exit(0)
}
if (process.env.BENCHMARK_DRY_RUN === '1') {
  const preview = await Promise.all(contests.map(async contest => ({
    contestId: contest.id,
    mode: contest.mode,
    submissions: (await listSubmissions(contest.id)).length,
    rejudge: await request(`/api/contests/${contest.id}/rejudge/preview?scopeType=all`),
  })))
  console.log(JSON.stringify({ contests: contestInfo.map(item => ({ id: item.id, mode: item.mode, title: item.data.title })), preview }, null, 2))
  process.exit(0)
}
const output = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  rounds,
  contests: contestInfo.map(item => ({ id: item.id, mode: item.mode, title: item.data.title, format: item.data.format })),
  roundResults: [],
}
const outputDirectory = process.env.BENCHMARK_OUTPUT_DIR || '/data/oi-manager-response-refactor/.run/benchmarks'
const outputPath = process.env.BENCHMARK_OUTPUT_PATH || path.join(outputDirectory, `20260815-mode-timing-${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}.json`)
await fs.mkdir(outputDirectory, { recursive: true })
await fs.writeFile(outputPath, JSON.stringify(output, null, 2))

for (let round = 1; round <= rounds; round += 1) {
  const before = await Promise.all(contests.map(async contest => ({ contest, rows: await listSubmissions(contest.id) })))
  const expectedIds = new Map(before.flatMap(item => item.rows.map(row => [row.id, item.contest.mode])))
  const observedCompletionMs = new Map()
  const startedAt = Date.now()
  const rejudgeResults = await Promise.all(contests.map(contest => request(`/api/contests/${contest.id}/rejudge`, {
    method: 'POST',
    body: JSON.stringify({ scope: { type: 'all' } }),
  })))

  while (observedCompletionMs.size < expectedIds.size) {
    const current = await Promise.all(contests.map(async contest => ({ contest, rows: await listSubmissions(contest.id) })))
    const now = Date.now()
    for (const item of current) {
      for (const row of item.rows) {
        if (!expectedIds.has(row.id) || observedCompletionMs.has(row.id)) continue
        if (terminalResults.has(normalizeResult(row.result))) observedCompletionMs.set(row.id, now - startedAt)
      }
    }
    if (Date.now() - startedAt > 30 * 60 * 1000) throw new Error(`Round ${round} timed out after 30 minutes`)
    if (observedCompletionMs.size < expectedIds.size) await sleep(500)
  }

  const finalLists = await Promise.all(contests.map(async contest => ({ contest, rows: await listSubmissions(contest.id) })))
  const records = (await Promise.all(finalLists.map(item => collectDetails(item.contest, item.rows, observedCompletionMs)))).flat()
  output.roundResults.push(summarizeRound(round, Date.now() - startedAt, rejudgeResults, records))
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2))
  console.log(JSON.stringify({ round, elapsedMs: output.roundResults.at(-1).elapsedMs, summary: output.roundResults.at(-1).summary }))
}

const allPairs = output.roundResults.flatMap(round => round.pairs)
output.aggregate = {
  rounds,
  pairObservations: allPairs.length,
  uniquePairs: new Set(allPairs.map(pair => pair.key)).size,
  resultInconsistencyObservations: output.roundResults.reduce((sum, round) => sum + round.summary.resultInconsistencyCount, 0),
  byMode: Object.fromEntries(['acm', 'ioi'].map(mode => {
    const records = output.roundResults.flatMap(round => round.records).filter(record => record.mode === mode)
    return [mode, {
      observations: records.length,
      observedCompletionMs: stats(records.map(record => record.observedCompletionMs).filter(Number.isFinite)),
      caseWallSumMs: stats(records.map(record => record.caseWallSumMs)),
      caseCpuSumMs: stats(records.map(record => record.caseCpuSumMs)),
      maxCaseWallMs: stats(records.map(record => record.maxCaseWallMs)),
    }]
  })),
  roundElapsedMs: stats(output.roundResults.map(round => round.elapsedMs)),
}

await fs.writeFile(outputPath, JSON.stringify(output, null, 2))
console.log(JSON.stringify({ outputPath, aggregate: output.aggregate }, null, 2))
