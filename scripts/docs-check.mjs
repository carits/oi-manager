import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docsRoot = path.join(root, 'docs')
const errors = []

const repositoryInstructions = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
const architectureProgress = JSON.parse(
  fs.readFileSync(path.join(docsRoot, 'architecture-progress.json'), 'utf8'),
)

if (/legacy and Feature UI\/Model transport calls are both zero/i.test(repositoryInstructions)) {
  errors.push('AGENTS.md contains the retired requirement to reduce Feature-local transport to zero')
}
if (architectureProgress.exitCriteria?.contractFeatureMigration?.includes('feature-local transport is observational')
  && !/Feature-local transport is observational and is not a zero target/i.test(repositoryInstructions)) {
  errors.push('AGENTS.md does not match the architecture progress contract for observational Feature-local transport')
}
for (const tier of ['Tier 1: local implementation', 'Tier 2: behavior or contract', 'Tier 3: architecture, data, or release']) {
  if (!repositoryInstructions.includes(tier)) {
    errors.push(`AGENTS.md is missing risk gate: ${tier}`)
  }
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(fullPath) : [fullPath]
  })
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/')
}

function normalizePath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '')
  return normalized || '/'
}

function compareSets(label, actual, documented) {
  const missing = [...actual].filter(item => !documented.has(item)).sort()
  const extra = [...documented].filter(item => !actual.has(item)).sort()
  if (missing.length) errors.push(`${label} missing from docs:\n  ${missing.join('\n  ')}`)
  if (extra.length) errors.push(`${label} only in docs:\n  ${extra.join('\n  ')}`)
}

const markdownFiles = walk(docsRoot).filter(file => file.endsWith('.md'))
const activeMarkdown = markdownFiles.filter(file => !relative(file).startsWith('docs/archive/'))
const archivedMarkdown = markdownFiles.filter(file => relative(file).startsWith('docs/archive/'))
const linkedMarkdown = [
  path.join(root, 'README.md'),
  path.join(root, 'CLAUDE.md'),
  ...markdownFiles,
]

for (const file of activeMarkdown) {
  const content = fs.readFileSync(file, 'utf8')
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!frontmatter) {
    errors.push(`${relative(file)} is missing frontmatter`)
    continue
  }
  for (const key of ['status', 'audience', 'last_verified', 'source_of_truth']) {
    if (!new RegExp(`^${key}:\\s*\\S`, 'm').test(frontmatter[1])) {
      errors.push(`${relative(file)} is missing frontmatter key: ${key}`)
    }
  }
  if (!/^status:\s*(current|reference)\s*$/m.test(frontmatter[1])) {
    errors.push(`${relative(file)} must use status current or reference`)
  }
}

for (const file of archivedMarkdown) {
  const content = fs.readFileSync(file, 'utf8')
  if (!/^---\r?\n[\s\S]*?^status:\s*archived\s*$[\s\S]*?^---/m.test(content)) {
    errors.push(`${relative(file)} must use status archived`)
  }
}

for (const file of linkedMarkdown) {
  const content = fs.readFileSync(file, 'utf8')
  const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g
  for (const match of content.matchAll(linkPattern)) {
    let target = match[1].trim()
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    if (/^(https?:|mailto:|#|\/)/.test(target)) continue
    if (!target.includes('/') && !target.includes('.')) continue
    target = decodeURIComponent(target.split('#')[0])
    if (!target) continue
    const resolved = path.resolve(path.dirname(file), target)
    if (!fs.existsSync(resolved)) {
      errors.push(`${relative(file)} has broken link: ${match[1]}`)
    }
  }
}

const codeReferencePattern =
  /`((?:(?:apps|packages|e2e|scripts|nginx)\/[^`\r\n]+)|(?:package\.json|docker-compose\.yml|ecosystem\.config\.js|playwright(?:\.live)?\.config\.ts))`/g
for (const file of activeMarkdown) {
  const content = fs.readFileSync(file, 'utf8')
  for (const match of content.matchAll(codeReferencePattern)) {
    const reference = match[1].replace(/\/+$/, '')
    if (/[<>{}*]/.test(reference) || /(?:^|\/)\.env(?:\.|$)/.test(reference)) continue
    if (!path.extname(reference)) continue
    if (!fs.existsSync(path.join(root, reference))) {
      errors.push(`${relative(file)} references missing code path: ${reference}`)
    }
  }
}

const stalePatterns = [
  ['SQLite test database URL', /file:\.\/prisma\/test\.db/],
  ['copying dev.db into test.db', /cp\s+prisma\/dev\.db\s+prisma\/test\.db/],
  ['empty submissions skeleton', /骨架.{0,12}(空数组|暂无实际数据)/],
  ['unused shared package', /packages\/shared.{0,20}暂未使用/],
  ['missing GitHub Actions claim', /没有\s*GitHub Actions/],
  ['planned CI claim', /📋\s*CI\/CD\s*配置/],
  ['obsolete 230 test snapshot', /230\+\s*单元测试/],
  ['obsolete 439 test snapshot', /439\s+vitest/],
  ['obsolete production-template-only claim', /生产配置仅作为模板保留，尚未在当前服务器启用/],
  ['obsolete PM2 production topology', /正式环境\s*\|\s*PM2|正式环境\s*\|\s*构建产物、PM2/],
  ['obsolete watch API runtime', /Server API\s*\|\s*`3002`\s*\|\s*`tsx watch/],
  ['obsolete fixed page-count claim', /提供\s*90\s*个页面路由/],
]

for (const file of activeMarkdown) {
  const content = fs.readFileSync(file, 'utf8')
  for (const [label, pattern] of stalePatterns) {
    if (pattern.test(content)) errors.push(`${relative(file)} contains stale claim: ${label}`)
  }
  for (const secretPattern of [
    /Bearer\s+eyJ[A-Za-z0-9_-]{20,}/,
    /\bsk-[A-Za-z0-9_-]{16,}\b/,
  ]) {
    if (secretPattern.test(content)) errors.push(`${relative(file)} may contain a committed secret`)
  }
}

const pageRoot = path.join(root, 'apps/web/src/app')
const sourceRoutes = new Set(
  walk(pageRoot)
    .filter(file => path.basename(file) === 'page.tsx')
    .map(file => {
      const route = path.relative(pageRoot, path.dirname(file)).replaceAll(path.sep, '/')
      return route ? `/${route}` : '/'
    }),
)

const routeDocument = fs.readFileSync(path.join(docsRoot, 'reference/WEB_ROUTES.md'), 'utf8')
const documentedRoutes = new Set(
  [...routeDocument.matchAll(/^\|\s*`(\/[^`]*)`\s*\|/gm)].map(match => match[1]),
)
compareSets('web routes', sourceRoutes, documentedRoutes)

const routeFixture = fs.readFileSync(path.join(root, 'e2e/fixtures/routes.ts'), 'utf8')
const fixtureBlock = routeFixture.match(/routePatterns\s*=\s*\[([\s\S]*?)]\s*as const/)
const fixtureRoutes = new Set(
  fixtureBlock ? [...fixtureBlock[1].matchAll(/['"](\/[^'"]*)['"]/g)].map(match => match[1]) : [],
)
compareSets('E2E route manifest', sourceRoutes, fixtureRoutes)

const prismaSchema = fs.readFileSync(path.join(root, 'apps/server/prisma/schema.prisma'), 'utf8')
const sourceModels = new Set(
  [...prismaSchema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(match => match[1]),
)
const modelDocument = fs.readFileSync(path.join(docsRoot, 'reference/DATABASE_SCHEMA.md'), 'utf8')
const documentedModels = new Set(
  [...modelDocument.matchAll(/^\|\s*`(\w+)`\s*\|/gm)].map(match => match[1]),
)
compareSets('Prisma models', sourceModels, documentedModels)

const routerPrefixes = {
  app: '',
  authRouter: '/api/auth',
  meRouter: '/api/me',
  teamRouter: '/api/teams',
  teamCrudRouter: '/api/teams',
  teamInvitationsRouter: '/api/teams',
  teamRequestsRouter: '/api/teams',
  teamMembersRouter: '/api/teams',
  userRouter: '/api/users',
  statsRouter: '/api/stats',
  problemsRouter: '/api/problems',
  problemCrudRouter: '/api/problems',
  problemFilesRouter: '/api/problems',
  problemNotesRouter: '/api/problems',
  problemAiRouter: '/api/problems',
  problemSubmissionsRouter: '/api/problems',
  problemJudgeRouter: '/api/problems',
  problemUserContentRouter: '/api/problems',
  problemStatementVersionRouter: '/api/problems',
  problemHackRouter: '/api/problems',
  problemTestGraphRouter: '/api/problems',
  problemTestSetRevisionRouter: '/api/problems',
  problemJudgeProgramRouter: '/api/problems',
  problemDataGenerationRouter: '/api/problems',
  judgeProgramTemplateRouter: '/api',
  problemCandidateRouter: '/api/problems',
  problemWrongCorpusRouter: '/api/problems',
  problemQualityRouter: '/api/problems',
  problemSolutionRouter: '/api/problems',
  solutionContributionRouter: '/api/solution-contributions',
  solutionRouter: '/api/solutions',
  solutionReviewRouter: '/api/review/solution-contributions',
  aiTokenAdminRouter: '/api/platform-admin/ai',
  ojFetcherRouter: '/api/oj-fetcher',
  filesRouter: '/api/files',
  platformBindingRouter: '/api/platform-bindings',
  teamImportRouter: '/api/team-import',
  submissionsRouter: '/api/submissions',
  problemListsRouter: '/api/problem-lists',
  problemSelectionRouter: '/api',
  teamProblemListsRouter: '/api/teams',
  ojAccountsRouter: '/api/oj-accounts',
  submitRouter: '/api/submit',
  testdataRouter: '/api',
  trainingsRouter: '/api',
  trainingEngineRouter: '/api',
  assignmentRouter: '/api',
  dataMarketRouter: '/api',
  blogRouter: '/api',
  ratingDomainRouter: '/api',
  trainingCrudRouter: '/api',
  trainingProblemsRouter: '/api',
  trainingNotesRouter: '/api',
  trainingRecordRouter: '/api',
  trainingSubmissionsRouter: '/api',
  trainingRankingRouter: '/api',
  trainingMiscRouter: '/api',
  trainingContentRouter: '/api',
  trainingStatementManagementRouter: '/api',
  trainingHackSyncRouter: '/api',
  adminDataRouter: '/api/admin/data',
  caritsRouter: '/api/carits',
  contributionRouter: '/api/contributions',
  platformContributionRouter: '/api/platform/contributions',
  resourceRouter: '/api/resources',
  rankingRouter: '/api/rankings',
  notificationRouter: '/api/notifications',
  workspaceRouter: '/api/workspaces',
  organizationMemberRouter: '/api/organizations/:organizationId/members',
  organizationJoinRouter: '/api',
  organizationCreationRouter: '/api',
  chatRouter: '/api/chat',
  chatReportAdminRouter: '/api/platform/chat-reports',
  chatStickerAdminRouter: '/api/platform',
  platformOrganizationRouter: '/api/platform/organizations',
  demoScenarioRouter: '/api/admin/demo-scenario',
  telemetryRouter: '/api/telemetry',
  healthRouter: '/api',
}

const endpointPattern =
  /\b([A-Za-z][A-Za-z0-9_]*)\.(get|post|put|patch|delete)\(\s*(["'])(\/[^"']*)\3/gms
const sourceEndpoints = new Set()
const unknownRouters = new Set()
const serverSourceFiles = walk(path.join(root, 'apps/server/src')).filter(file => {
  const filePath = relative(file)
  return file.endsWith('.ts') &&
    (filePath === 'apps/server/src/index.ts' ||
      filePath.includes('/routes/') ||
      filePath.endsWith('.routes.ts'))
})

for (const file of serverSourceFiles) {
  const content = fs.readFileSync(file, 'utf8')
  for (const match of content.matchAll(endpointPattern)) {
    const router = match[1]
    if (!(router in routerPrefixes)) {
      unknownRouters.add(`${router} (${relative(file)})`)
      continue
    }
    const endpoint = `${match[2].toUpperCase()} ${normalizePath(routerPrefixes[router] + match[4])}`
    sourceEndpoints.add(endpoint)
  }
}
if (unknownRouters.size) {
  errors.push(`route prefixes missing for:\n  ${[...unknownRouters].sort().join('\n  ')}`)
}

const apiDocs = walk(path.join(docsRoot, 'reference/api')).filter(file => file.endsWith('.md'))
const documentedEndpoints = new Set()
const documentedEndpointPattern =
  /^\|\s*`(GET|POST|PUT|PATCH|DELETE)`\s*\|\s*`(\/api[^`]*)`\s*\|/gm
for (const file of apiDocs) {
  const content = fs.readFileSync(file, 'utf8')
  for (const match of content.matchAll(documentedEndpointPattern)) {
    documentedEndpoints.add(`${match[1]} ${normalizePath(match[2])}`)
  }
}
compareSets('HTTP endpoints', sourceEndpoints, documentedEndpoints)

if (errors.length) {
  console.error(`Documentation check failed with ${errors.length} issue(s):\n`)
  for (const error of errors) console.error(`- ${error}\n`)
  process.exit(1)
}

console.log(
  `Documentation check passed: ${activeMarkdown.length} active docs, ` +
    `${sourceRoutes.size} routes, ${sourceModels.size} models, ` +
    `${sourceEndpoints.size} HTTP endpoints.`,
)
