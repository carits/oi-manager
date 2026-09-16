import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const outputFile = path.join(root, 'docs/architecture-progress.json')
const args = new Set(process.argv.slice(2))

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function auditTransport() {
  const output = execFileSync(process.execPath, ['scripts/audit-api-contract-layer.mjs', '--progress'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  })
  return JSON.parse(output)
}

function contestCompatibility() {
  const schema = fs.readFileSync(path.join(root, 'apps/server/prisma/schema.prisma'), 'utf8')
  const aggregate = fs.readFileSync(path.join(root, 'apps/server/src/modules/contest/contest-aggregate.service.ts'), 'utf8')
  const command = fs.readFileSync(path.join(root, 'apps/server/src/modules/contest/contest-command.service.ts'), 'utf8')
  const points = [
    { key: 'runtimeTrainingIdentity', active: /\bruntimeTrainingId\s+Int\??\b/.test(schema) },
    { key: 'trainingProjectionWriter', active: /export async function projectContestRuntimeTx\b/.test(aggregate) },
    { key: 'trainingRuntimeCreation', active: /createContestRuntimeTx[\s\S]*?tx\.training\.create\s*\(/.test(command) },
    { key: 'trainingProblemRuntime', active: /tx\.trainingProblem\.(?:create|update|delete|findMany|findFirst)\s*\(/.test(command) },
  ]
  return { remaining: points.filter(point => point.active).length, points }
}

function httpsStatus() {
  const evidenceFile = path.join(root, 'docs/operations/production-https-evidence.json')
  const empty = { publicHttps: false, secureCookie: false, csp: false, hsts: false, externalHttpsProbe: false }
  if (!fs.existsSync(evidenceFile)) return { ...empty, evidence: null }
  const evidence = readJson(evidenceFile)
  return {
    ...Object.fromEntries(Object.keys(empty).map(key => [key, evidence[key] === true])),
    evidence: 'docs/operations/production-https-evidence.json',
  }
}

function calculate() {
  const transport = auditTransport()
  const topDebt = [
    ...transport.legacyTransportDebt.map(item => ({ ...item, layer: 'legacy' })),
    ...transport.featureTransportDebt.map(item => ({ ...item, layer: 'feature' })),
  ].sort((left, right) => right.calls - left.calls || left.file.localeCompare(right.file)).slice(0, 12)
  return {
    schemaVersion: 1,
    contracts: transport.contractFiles,
    featureSlices: transport.featureSlices,
    contractedBoundaries: transport.contractedBoundaries,
    transport: {
      legacy: { files: transport.remainingLegacyTransportFiles, calls: transport.remainingLegacyTransportCalls },
      feature: { files: transport.remainingLegacyFeatureTransportFiles, calls: transport.remainingLegacyFeatureTransportCalls },
    },
    contestCompatibility: contestCompatibility(),
    https: httpsStatus(),
    topDebt,
    exitCriteria: {
      contractFeatureMigration: 'transport.legacy.calls == 0 && transport.feature.calls == 0',
      contestRuntimeRetirement: 'contestCompatibility.remaining == 0',
      productionHttps: 'all https flags are true',
    },
  }
}

function metrics(value) {
  const clone = structuredClone(value)
  delete clone.updatedAt
  return clone
}

function summary(previous, current) {
  const delta = (label, before, after) => `${label} ${before ?? '—'}→${after}`
  return [
    delta('contracts', previous?.contracts, current.contracts),
    delta('feature slices', previous?.featureSlices, current.featureSlices),
    delta('boundaries', previous?.contractedBoundaries, current.contractedBoundaries),
    delta('legacy transport', previous?.transport?.legacy?.calls, current.transport.legacy.calls),
    delta('feature transport', previous?.transport?.feature?.calls, current.transport.feature.calls),
    delta('contest compatibility', previous?.contestCompatibility?.remaining, current.contestCompatibility.remaining),
    `https ${Object.entries(current.https).filter(([key, value]) => key !== 'evidence' && value === true).length}/5`,
  ].join('\n')
}

function loadGitVersion(ref) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${ref}:docs/architecture-progress.json`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  } catch { return null }
}

const current = calculate()
const checkedIn = fs.existsSync(outputFile) ? readJson(outputFile) : null

if (args.has('--check')) {
  if (!checkedIn || JSON.stringify(metrics(checkedIn)) !== JSON.stringify(metrics(current))) {
    console.error('docs/architecture-progress.json is stale. Run pnpm architecture:progress and commit the result.')
    process.exit(1)
  }
}

if (args.has('--gate')) {
  const baseRef = process.env.ARCHITECTURE_PROGRESS_BASE_REF || process.env.GITHUB_BASE_SHA || 'HEAD^'
  const previous = loadGitVersion(baseRef)
  if (previous) {
    const regressions = []
    if (current.transport.legacy.calls > previous.transport.legacy.calls) regressions.push('legacy transport calls increased')
    if (current.transport.feature.calls > previous.transport.feature.calls) regressions.push('feature transport calls increased')
    if (current.contracts < previous.contracts) regressions.push('contract count decreased')
    if (current.featureSlices < previous.featureSlices) regressions.push('feature slice count decreased')
    if (current.contractedBoundaries < previous.contractedBoundaries) regressions.push('contracted boundary count decreased')
    if (current.contestCompatibility.remaining > previous.contestCompatibility.remaining) regressions.push('contest compatibility debt increased')
    for (const key of ['publicHttps', 'secureCookie', 'csp', 'hsts', 'externalHttpsProbe']) {
      if (previous.https[key] === true && current.https[key] !== true) regressions.push(`HTTPS evidence regressed: ${key}`)
    }
    if (regressions.length) {
      console.error(regressions.join('\n'))
      process.exit(1)
    }
  }
}

if (!args.has('--check') && !args.has('--gate')) {
  const next = { ...current, updatedAt: new Date().toISOString() }
  fs.writeFileSync(outputFile, `${JSON.stringify(next, null, 2)}\n`)
}

const previous = loadGitVersion(process.env.ARCHITECTURE_PROGRESS_BASE_REF || process.env.GITHUB_BASE_SHA || 'HEAD^')
const text = summary(previous, current)
console.log(text)
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Architecture progress\n\n\`\`\`text\n${text}\n\`\`\`\n\n### Top debt\n${current.topDebt.map(item => `- ${item.calls} — \`${item.file}\``).join('\n')}\n`)
}
