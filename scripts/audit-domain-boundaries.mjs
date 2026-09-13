import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const modulesRoot = path.join(root, 'apps/server/src/modules')

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name)
    return entry.isDirectory() ? files(target) : entry.isFile() && target.endsWith('.ts') ? [target] : []
  })
}

const violations = []
const sharedTypes = fs.readFileSync(path.join(root, 'packages/shared/src/index.ts'), 'utf8')
for (const obsoleteContract of ['ApiResponse', 'LoginRequest', 'LoginResponse']) {
  if (new RegExp(`export\\s+interface\\s+${obsoleteContract}\\b`).test(sharedTypes)) {
    violations.push(`Shared package redefines ${obsoleteContract}; use @oi-manager/contracts`)
  }
}
if (fs.existsSync(path.join(root, 'apps/server/src/lib/api.ts'))) {
  violations.push('Server contains a browser-style API client outside the contracts/client boundary')
}
const serverIndex = fs.readFileSync(path.join(root, 'apps/server/src/index.ts'), 'utf8')
const applicationRoot = fs.readFileSync(path.join(root, 'apps/server/src/app.ts'), 'utf8')
const serverRuntime = fs.readFileSync(path.join(root, 'apps/server/src/server-runtime.ts'), 'utf8')
const testRequestHelper = fs.readFileSync(path.join(root, 'apps/server/tests/helpers/testRequest.ts'), 'utf8')
const judgeWebSocket = fs.readFileSync(path.join(root, 'apps/server/src/ws/judge.ts'), 'utf8')
if (!serverIndex.includes('createApplication()') || !serverIndex.includes('startServerRuntime(app)')) {
  violations.push('Server bootstrap bypasses the runtime composition root')
}
if (/\bapp\.(?:use|get|post|put|patch|delete|listen)\s*\(/.test(serverIndex)) {
  violations.push('Server bootstrap defines HTTP routes or sockets outside the runtime composition root')
}
if (!applicationRoot.includes("app.use('/api', healthRouter)")
  || !applicationRoot.includes("app.use('/api/chat', chatRouter)")
  || !applicationRoot.includes("import { meRouter } from './routes/me'")) {
  violations.push('Application composition root is missing required production routes')
}
if (!serverRuntime.includes('initJudgeWebSocket(httpServer)')) {
  violations.push('Server runtime does not inject the HTTP server into Judge WebSocket')
}
if (!testRequestHelper.includes("from '../../src/app'") || !testRequestHelper.includes('createApplication({')) {
  violations.push('Integration tests bypass the production application composition root')
}
if (/from ['"]\.\.\/\.\.\/src\/(?:routes|modules\/[^'"]+\.routes)/.test(testRequestHelper)
  || /\/api\/health/.test(testRequestHelper)) {
  violations.push('Integration test helper maintains a shadow route graph')
}
if (/global\s+as\s+any\)\.httpServer|global\.httpServer/.test(judgeWebSocket + serverIndex)) {
  violations.push('Judge WebSocket depends on an implicit global HTTP server')
}
const assignment = fs.readFileSync(path.join(modulesRoot, 'assignment/assignment.service.ts'), 'utf8')
if (/\.\.\/training\/training\.helpers/.test(assignment)) violations.push('Assignment imports Training authorization helpers')

for (const file of files(modulesRoot)) {
  const relative = path.relative(modulesRoot, file).replaceAll('\\', '/')
  if (relative.startsWith('contest/') || relative.startsWith('maintenance/')) continue
  const source = fs.readFileSync(file, 'utf8')
  if (/(?:prisma|tx)\.contest(?:Problem)?\.(?:create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(/.test(source)) {
    violations.push(`${relative} writes Contest projection outside aggregate boundary`)
  }
}

const judgeRun = fs.readFileSync(path.join(modulesRoot, 'judge/application/judge-run.service.ts'), 'utf8')
if (/clearedSubmissionProjection|data:\s*\{\s*(?:\.\.\.input\.projection|result:\s*['"]judging['"])/s.test(judgeRun)) {
  violations.push('JudgeRun service writes local result projection back to Submission')
}

const contestRating = fs.readFileSync(path.join(modulesRoot, 'rating/application/contest-rating.service.ts'), 'utf8')
const contestQueryFacade = fs.readFileSync(path.join(modulesRoot, 'contest/contest-query.facade.ts'), 'utf8')
if (contestQueryFacade.includes("source: 'legacy'") || contestQueryFacade.includes('contest_query_legacy_fallback')) {
  violations.push('Contest query facade still returns legacy Training contest records')
}
if (!contestRating.includes("from '../../contest/contest-query.facade'")) {
  violations.push('Contest Rating bypasses the Contest query facade')
}
const trainingCrud = fs.readFileSync(path.join(modulesRoot, 'training/application/training-crud.service.ts'), 'utf8')
if (!trainingCrud.includes('listPlatformContestRuntimes')) {
  violations.push('Platform contest list bypasses the Contest query facade')
}
const dataMarket = fs.readFileSync(path.join(modulesRoot, 'data-market/data-market.service.ts'), 'utf8')
if (!dataMarket.includes('findContestRuntimeForLicense') || !dataMarket.includes('listContestRuntimeIdsForLicenseScopes')) {
  violations.push('Data Market contest license bypasses the Contest query facade')
}
const dashboard = fs.readFileSync(path.join(modulesRoot, 'dashboard/application/dashboard.service.ts'), 'utf8')
if (!dashboard.includes('listContestRuntimesForDashboard')) {
  violations.push('Dashboard contest discovery bypasses the Contest query facade')
}
const organizationMember = fs.readFileSync(path.join(modulesRoot, 'organization/application/organization-member.service.ts'), 'utf8')
if (!organizationMember.includes('listContestRuntimesForDashboard')) {
  violations.push('Organization contest discovery bypasses the Contest query facade')
}
const trainingRanking = fs.readFileSync(path.join(modulesRoot, 'training/application/training-ranking.service.ts'), 'utf8')
if (!trainingRanking.includes('findActivityRuntimeForRanking')) {
  violations.push('Contest ranking bypasses the Contest query facade')
}
const blog = fs.readFileSync(path.join(modulesRoot, 'blog/blog.service.ts'), 'utf8')
if (!blog.includes('findContestRuntimeForBlogReview')) {
  violations.push('Blog contest review bypasses the Contest query facade')
}
if (!contestRating.includes('listDueRatedContestRuntimes')) {
  violations.push('Rating scheduler bypasses the Contest query facade')
}
if (!contestRating.includes('beginContestFinalizationTx')
  || !contestRating.includes('completeContestFinalizationTx')
  || !contestRating.includes('completeContestRatingRebuildTx')
  || !contestRating.includes('failContestFinalizationTx')) {
  violations.push('Contest Rating finalization bypasses the Contest command service')
}
if (/training\.(?:update|updateMany)\([\s\S]{0,220}(?:finalizationStatus|finalizedStandingId)/.test(contestRating)) {
  violations.push('Contest Rating writes finalization state outside the Contest command service')
}
const submissionQuery = fs.readFileSync(path.join(modulesRoot, 'submission/application/submission-query.service.ts'), 'utf8')
if (!submissionQuery.includes('findActivityRuntimeForSubmission')) {
  violations.push('Submission contest detail bypasses the Contest query facade')
}
const trainingMisc = fs.readFileSync(path.join(modulesRoot, 'training/application/training-misc.service.ts'), 'utf8')
if (!trainingMisc.includes('findActivityRuntimeForAccess') || !trainingMisc.includes('findActivityRuntimeForOverview')) {
  violations.push('Activity overview or resource access bypasses the Contest query facade')
}
const trainingProblemQuery = fs.readFileSync(path.join(modulesRoot, 'training/application/training-problem-query.service.ts'), 'utf8')
if (!trainingProblemQuery.includes('findActivityRuntimeForAccess')) {
  violations.push('Activity problem access bypasses the Contest query facade')
}
const trainingScope = fs.readFileSync(path.join(modulesRoot, 'training/application/training-scope.service.ts'), 'utf8')
const trainingVisibility = fs.readFileSync(path.join(modulesRoot, 'training/training.visibility.ts'), 'utf8')
if (!trainingScope.includes('findActivityRuntimeForAccess') || !trainingVisibility.includes('findActivityRuntimeForAccess')) {
  violations.push('Activity scope or visibility bypasses the Contest query facade')
}
const trainingContent = fs.readFileSync(path.join(modulesRoot, 'training/application/training-content-management.service.ts'), 'utf8')
if (!trainingContent.includes('findActivityRuntimeForAccess')) {
  violations.push('Activity content access bypasses the Contest query facade')
}
if (!judgeRun.includes('holdContestFinalizationForRejudgeTx')) {
  violations.push('Judge rejudge finalization bypasses the Contest command service')
}
if (!trainingCrud.includes('createContestRuntimeTx') || !organizationMember.includes('createContestRuntimeTx')) {
  violations.push('Contest creation bypasses the Contest command service')
}
if (!trainingCrud.includes('transitionContestLifecycleTx')) {
  violations.push('Contest lifecycle bypasses the Contest command service')
}
if (!trainingCrud.includes('updateContestRuntimeTx')) {
  violations.push('Contest metadata update bypasses the Contest command service')
}
if (!trainingCrud.includes('deleteContestRuntimeTx')) {
  violations.push('Contest deletion bypasses the Contest command service')
}
const contestCommand = fs.readFileSync(path.join(modulesRoot, 'contest/contest-command.service.ts'), 'utf8')
const contestFinalizationCommand = fs.readFileSync(path.join(modulesRoot, 'contest/contest-finalization-command.service.ts'), 'utf8')
if ((contestCommand + contestFinalizationCommand).includes('contest_command_legacy_fallback')) {
  violations.push('Contest command service still mutates legacy Training contest records without a canonical aggregate')
}
if (contestFinalizationCommand.includes('ensureContestAggregateTx')
  || /tx\.training\.(?:update|updateMany)\s*\(/.test(contestFinalizationCommand)) {
  violations.push('Contest finalization still treats Training as the authoritative write model')
}
if (!contestFinalizationCommand.includes('projectContestRuntimeTx')
  || !contestCommand.includes('projectContestRuntimeTx')) {
  violations.push('Contest commands do not maintain the Training compatibility projection')
}
if (/prisma\.training\.findMany\([\s\S]{0,500}finalizationStatus/.test(contestQueryFacade)) {
  violations.push('Contest Rating discovery still reads lifecycle state from Training')
}
const trainingProblemManagement = fs.readFileSync(path.join(modulesRoot, 'training/application/training-problem-management.service.ts'), 'utf8')
for (const command of [
  'createContestProblemRuntimeTx',
  'reorderContestProblemRuntimesTx',
  'updateContestProblemRuntimeTx',
  'deleteContestProblemRuntimeTx',
]) {
  if (!trainingProblemManagement.includes(command)) {
    violations.push(`Contest problem management bypasses ${command}`)
  }
}
if (trainingProblemManagement.includes("from '../../contest/contest-aggregate.service'")) {
  violations.push('Training problem management imports the Contest aggregate writer directly')
}
for (const directLifecyclePattern of [
  /training\.type\s*===\s*['"]contest['"][\s\S]{0,240}tx\.training\.update\([^)]*status:/,
  /tx\.training\.update\([^)]*finalizationStatus:\s*['"]JUDGING['"]/,
]) {
  if (directLifecyclePattern.test(trainingCrud)) {
    violations.push('Training CRUD writes contest lifecycle outside the Contest command service')
  }
}

console.log(JSON.stringify({
  assignmentAuthorizationBoundary: !violations.some(item => item.startsWith('Assignment')),
  contestProjectionBoundary: !violations.some(item => item.includes('Contest projection')),
  contestQueryFacadeBoundary: !violations.some(item => item.includes('Contest query facade')),
  contestCommandBoundary: !violations.some(item => item.includes('Contest command service')),
  contestCanonicalStateBoundary: !violations.some(item => item.includes('authoritative write model')
    || item.includes('compatibility projection')
    || item.includes('Rating discovery still reads lifecycle')),
  localJudgeResultWriteBoundary: !violations.some(item => item.startsWith('JudgeRun')),
  runtimeCompositionBoundary: !violations.some(item => item.includes('composition root') || item.includes('shadow route graph') || item.includes('implicit global HTTP server')),
  violations,
}, null, 2))

if (violations.length) process.exitCode = 1
