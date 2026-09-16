import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const outputFile = process.env.ARCHITECTURE_PROGRESS_FILE
  ? path.resolve(root, process.env.ARCHITECTURE_PROGRESS_FILE)
  : path.join(root, 'docs/architecture-progress.json')
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

function remoteArchiveStatus() {
  const retiredFiles = [
    'apps/server/src/routes/archived-problems.ts',
    'apps/server/src/modules/archived-problem/application/archived-problem.service.ts',
    'apps/server/src/modules/platform-binding/binders/codeforces-archiver.ts',
    'apps/server/src/modules/platform-binding/binders/luogu-archiver.ts',
    'apps/server/src/lib/cf-code-fetcher.ts',
  ]
  const sourceFiles = [
    'apps/server/src/app.ts',
    'apps/server/src/modules/platform-binding/platform-binding.routes.ts',
    'apps/server/src/modules/judge/application/judge-read-projection.ts',
    'apps/web/src/features/submission/model/useSubmissionDetail.ts',
  ]
  const activePatterns = /sync-archive|sync-submissions|archived-problems|UserArchivedProblem|submitMethod\s*[:=]\s*['"]archive['"]/g
  const activeReferences = sourceFiles.reduce((total, file) => {
    if (!fs.existsSync(path.join(root, file))) return total
    return total + (fs.readFileSync(path.join(root, file), 'utf8').match(activePatterns)?.length ?? 0)
  }, 0)
  const implementationFiles = retiredFiles.filter(file => fs.existsSync(path.join(root, file))).length
  const evidenceFile = path.join(root, 'docs/operations/remote-archive-retirement-evidence.json')
  const evidence = fs.existsSync(evidenceFile) ? readJson(evidenceFile) : null
  return {
    implementationFiles,
    activeReferences,
    modelPresent: /model\s+UserArchivedProblem\b/.test(fs.readFileSync(path.join(root, 'apps/server/prisma/schema.prisma'), 'utf8')),
    databaseSubmissions: evidence?.databaseSubmissions ?? null,
    databaseArchivedProblems: evidence?.databaseArchivedProblems ?? null,
    migrationVerified: evidence?.migrationVerified === true,
    evidence: evidence ? 'docs/operations/remote-archive-retirement-evidence.json' : null,
  }
}

function judgeCompatibilityStatus() {
  const schema = fs.readFileSync(path.join(root, 'apps/server/prisma/schema.prisma'), 'utf8')
  const compatibilityColumns = [
    'result', 'timeUsed', 'wallTimeUsed', 'memoryUsed', 'timeoutReason', 'metricSource',
    'errorMessage', 'cases', 'score', 'subtasks', 'judgeId', 'judgeStarted',
  ]
  const submission = schema.match(/model Submission \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const remainingColumns = compatibilityColumns.filter(column => new RegExp(`^\\s*${column}\\s+`, 'm').test(submission))
  return { remainingColumns: remainingColumns.length, columns: remainingColumns }
}

function evidenceStatus(file, keys) {
  const absolute = path.join(root, 'docs/operations', file)
  const evidence = fs.existsSync(absolute) ? readJson(absolute) : null
  return {
    ...Object.fromEntries(keys.map(key => [key, evidence?.[key] === true])),
    evidence: evidence ? `docs/operations/${file}` : null,
  }
}

function calculate() {
  const transport = auditTransport()
  const topDebt = [
    ...transport.legacyTransportDebt.map(item => ({ ...item, layer: 'legacy' })),
    ...transport.featureTransportDebt.map(item => ({ ...item, layer: 'feature' })),
  ].sort((left, right) => right.calls - left.calls || left.file.localeCompare(right.file)).slice(0, 12)
  return {
    schemaVersion: 2,
    contracts: transport.contractFiles,
    featureSlices: transport.featureSlices,
    contractedBoundaries: transport.contractedBoundaries,
    transport: {
      legacy: { files: transport.remainingLegacyTransportFiles, calls: transport.remainingLegacyTransportCalls },
      feature: { files: transport.remainingLegacyFeatureTransportFiles, calls: transport.remainingLegacyFeatureTransportCalls },
    },
    contestCompatibility: contestCompatibility(),
    remoteArchive: remoteArchiveStatus(),
    judgeCompatibility: judgeCompatibilityStatus(),
    pitr: evidenceStatus('production-pitr-evidence.json', ['walArchive', 'offHostStorage', 'restoreExercise', 'rpoMet', 'rtoMet']),
    externalAlerting: evidenceStatus('production-alerting-evidence.json', ['realRecipient', 'faultDelivered', 'recoveryDelivered']),
    cloudMonitoring: evidenceStatus('production-cloud-monitoring-evidence.json', ['host', 'http', 'database', 'judge', 'backup']),
    https: httpsStatus(),
    topDebt,
    exitCriteria: {
      contractFeatureMigration: 'transport.legacy.calls == 0 && transport.feature.calls == 0',
      contestRuntimeRetirement: 'contestCompatibility.remaining == 0',
      remoteArchiveRetirement: 'remoteArchive code/model counts and database counts are zero and migrationVerified is true',
      judgeCompatibilityRetirement: 'judgeCompatibility.remainingColumns == 0',
      pitr: 'all pitr flags are true',
      externalAlerting: 'all externalAlerting flags are true',
      cloudMonitoring: 'all cloudMonitoring flags are true',
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
    delta('remote archive code', (previous?.remoteArchive?.implementationFiles ?? 0) + (previous?.remoteArchive?.activeReferences ?? 0), current.remoteArchive.implementationFiles + current.remoteArchive.activeReferences),
    delta('judge compatibility columns', previous?.judgeCompatibility?.remainingColumns, current.judgeCompatibility.remainingColumns),
    `https ${Object.entries(current.https).filter(([key, value]) => key !== 'evidence' && value === true).length}/5`,
  ].join('\n')
}

function loadGitVersion(ref) {
  if (process.env.ARCHITECTURE_PROGRESS_BASE_FILE) {
    try { return readJson(path.resolve(root, process.env.ARCHITECTURE_PROGRESS_BASE_FILE)) } catch { return null }
  }
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
    if (previous.remoteArchive && current.remoteArchive.implementationFiles + current.remoteArchive.activeReferences > previous.remoteArchive.implementationFiles + previous.remoteArchive.activeReferences) regressions.push('remote archive code debt increased')
    if (previous.judgeCompatibility && current.judgeCompatibility.remainingColumns > previous.judgeCompatibility.remainingColumns) regressions.push('judge compatibility debt increased')
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
  const unchanged = checkedIn && JSON.stringify(metrics(checkedIn)) === JSON.stringify(metrics(current))
  const next = { ...current, updatedAt: unchanged ? checkedIn.updatedAt : new Date().toISOString() }
  const serialized = `${JSON.stringify(next, null, 2)}\n`
  if (!fs.existsSync(outputFile) || fs.readFileSync(outputFile, 'utf8') !== serialized) {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true })
    fs.writeFileSync(outputFile, serialized)
  }
}

const previous = loadGitVersion(process.env.ARCHITECTURE_PROGRESS_BASE_REF || process.env.GITHUB_BASE_SHA || 'HEAD^')
const text = summary(previous, current)
console.log(text)
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Architecture progress\n\n\`\`\`text\n${text}\n\`\`\`\n\n### Top debt\n${current.topDebt.map(item => `- ${item.calls} — \`${item.file}\``).join('\n')}\n`)
}
