import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const failures = []
const resolve = relative => path.join(root, relative)
const exists = relative => fs.existsSync(resolve(relative))
const read = relative => fs.readFileSync(resolve(relative), 'utf8')

function collect(relative) {
  if (!exists(relative)) return []
  const absolute = resolve(relative)
  const stat = fs.statSync(absolute)
  if (stat.isFile()) return [relative]
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    if (['dist', 'node_modules', '.next', '.next-current'].includes(entry.name)) return []
    return collect(path.join(relative, entry.name))
  })
}

function modelBlock(schema, name) {
  return schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] || ''
}

function forbidFiles(files) {
  for (const file of files) if (exists(file)) failures.push(`retired compatibility file still exists: ${file}`)
}

function forbidPattern(files, pattern, label) {
  for (const file of files) {
    if (!/\.(?:ts|tsx|prisma)$/.test(file)) continue
    if (pattern.test(read(file))) failures.push(`${label}: ${file}`)
    pattern.lastIndex = 0
  }
}

const activeCode = [
  ...collect('apps/server/src'),
  ...collect('apps/server/tests'),
  ...collect('e2e'),
  ...collect('apps/web/src'),
  ...collect('packages/contracts/src'),
  ...collect('packages/shared/src'),
]

forbidFiles([
  'apps/server/src/routes/milestones.ts',
  'apps/server/src/routes/teachers.ts',
  'apps/server/src/routes/students.ts',
  'apps/server/tests/school-team-problem-lists.test.ts',
  'apps/server/tests/training-compatibility.test.ts',
  'apps/server/tests/activity-workspace-regression.test.ts',
  'apps/server/tests/helpers/legacy-contest-fixture.ts',
  'ui-audit.spec.ts',
  '.claude/settings.local.json',
  'apps/web/src/components/LegacyRouteRetired.tsx',
  'apps/web/src/app/student/[[...legacy]]/page.tsx',
  'apps/web/src/app/teacher/[[...legacy]]/page.tsx',
  'apps/server/src/modules/maintenance/application/assignment-migration.service.ts',
  'apps/server/src/modules/maintenance/application/economy-loop-migration.service.ts',
  'apps/server/src/modules/maintenance/application/judge-program-protocol-migration.service.ts',
  'apps/server/src/modules/maintenance/application/membership-role-migration.service.ts',
  'apps/server/src/modules/maintenance/application/school-name-key-migration.service.ts',
  'apps/server/src/modules/maintenance/application/submission-io-migration.service.ts',
  'apps/server/src/modules/maintenance/application/test-graph-migration-route.service.ts',
])
const compatibilityCode = activeCode.filter(file => ![
  'apps/server/tests/authorization-boundary.test.ts',
  'apps/server/tests/client-telemetry.test.ts',
].includes(file))

forbidPattern(activeCode, /\bLegacyUserRoleSchema\b/g, 'legacy role schema is forbidden')
forbidPattern(compatibilityCode, /\bstudentMode\b/g, 'legacy student mode is forbidden')
forbidPattern(compatibilityCode, /\bBearer\b|Authorization:\s*['"`]Bearer/g, 'Bearer authentication is forbidden in application and E2E code')
forbidPattern(compatibilityCode, /role:\s*account\.loginRole/g, 'role-selecting login fixture is forbidden')
forbidPattern(activeCode, /['"`]\/(?:student|teacher)(?:\/|['"`])/g, 'retired role workspace route is forbidden')
forbidPattern(activeCode, /\baccountRoleFromLegacy\b/g, 'legacy JWT role conversion is forbidden')

for (const file of [
  'playwright.config.ts',
  'playwright.fault.config.ts',
  'playwright.restore.config.ts',
  'playwright.stress.config.ts',
]) if (exists(file) && read(file).includes('ENABLE_MAINTENANCE_API')) failures.push(`retired maintenance flag remains: ${file}`)
forbidPattern(activeCode, /req\.user!?\.role\b/g, 'ambiguous request role access is forbidden')
forbidPattern(activeCode, /\/api\/(?:teachers|students|schools)(?:\/|['"`])/g, 'retired role/school API path is forbidden')
forbidPattern(activeCode, /\/api\/admin\/migration(?:\/|['"`])/g, 'runtime migration HTTP API is forbidden')
forbidPattern(activeCode, /publish-homework|hack-sync-preview|HACK_SYNC_RETIRED|LEGACY_HOMEWORK_API_RETIRED/g, 'retired route tombstone is forbidden')

const authContract = read('packages/contracts/src/auth.ts')
const loginRequest = authContract.match(/export const LoginRequestSchema = z\.object\(\{([\s\S]*?)\}\)\.strict\(\)/)?.[1] || ''
if (/\bmode\s*:/.test(loginRequest)) failures.push('LoginRequestSchema still accepts deprecated mode')
if (/\brole\s*:/.test(authContract)) failures.push('auth contract still exposes ambiguous role')

const authMiddleware = read('apps/server/src/middleware/auth.ts')
if (!authMiddleware.includes('getSessionToken(req)')) failures.push('authentication no longer uses the canonical session cookie')
if (/\bbearer\b|headers\.authorization|get\(['"]authorization['"]\)/i.test(authMiddleware)) {
  failures.push('browser authentication still contains Authorization/Bearer compatibility')
}

const shared = read('packages/shared/src/index.ts')
const sessionClaims = shared.match(/export interface SessionJwtPayload \{([\s\S]*?)\n\}/)?.[1] || ''
for (const claim of ['role', 'teacherId', 'studentId', 'schoolId', 'mode']) {
  if (new RegExp(`\\b${claim}\\??\\s*:`).test(sessionClaims)) failures.push(`legacy session claim remains: ${claim}`)
}

const schema = read('apps/server/prisma/schema.prisma')
for (const model of ['Student', 'Teacher', 'Admin']) {
  if (new RegExp(`model ${model} \\{`).test(schema)) failures.push(`legacy Prisma model remains: ${model}`)
}
if (/\bschoolId\b/.test(modelBlock(schema, 'User'))) failures.push('User still carries campus schoolId')
const membershipRole = modelBlock(schema, 'OrganizationMembershipRole')
if (!/source\s+String\s+@default\("application"\)/.test(membershipRole)) failures.push('membership role source default is not application')
const loginLog = modelBlock(schema, 'LoginLog')
if (/\b(?:loginRole|userRole)\b/.test(loginLog)) failures.push('LoginLog still carries legacy role fields')
const repositoryConfigs = ['.claude/settings.json']
for (const file of repositoryConfigs) {
  if (!exists(file)) continue
  const source = read(file)
  if (/Bearer|eyJhbGciOi|studentMode|\/(?:student|teacher)\//.test(source)) {
    failures.push(`retired compatibility or credential remains in repository config: ${file}`)
  }
}

if (failures.length) {
  console.error('Internal compatibility retirement audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Internal compatibility retirement audit passed.')
