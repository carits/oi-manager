import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const exists = relative => fs.existsSync(path.join(root, relative))
const failures = []

const contractFiles = [
  'packages/contracts/src/http.ts',
  'packages/contracts/src/auth.ts',
  'packages/contracts/src/health.ts',
  'packages/contracts/src/identity.ts',
  'packages/contracts/src/assignment.ts',
  'packages/contracts/src/blog.ts',
  'packages/contracts/src/rating.ts',
  'packages/contracts/src/solution-review.ts',
]
for (const file of contractFiles) {
  if (!exists(file)) failures.push(`missing shared contract: ${file}`)
}

const http = read('packages/contracts/src/http.ts')
for (const symbol of [
  'defineApiEndpoint',
  'ApiEnvelope',
  'PaginationQuerySchema',
  'PaginationMetaSchema',
  'FieldIssueSchema',
]) {
  if (!http.includes(symbol)) failures.push(`HTTP contract is missing ${symbol}`)
}

const apiClient = read('apps/web/src/lib/apiClient.ts')
for (const symbol of ['queryContract', 'mutateContract', 'safeParse']) {
  if (!apiClient.includes(symbol)) failures.push(`browser contract client is missing ${symbol}`)
}

const serverAdapter = read('apps/server/src/lib/api-contract.ts')
for (const symbol of ['parseContractBody', 'parseContractQuery', 'sendContractData']) {
  if (!serverAdapter.includes(symbol)) failures.push(`server contract adapter is missing ${symbol}`)
}

const slices = ['assignment', 'blog', 'contest-rating', 'solution-review', 'submission']
function containsSourceFiles(directory) {
  if (!exists(directory)) return false
  return fs.readdirSync(path.join(root, directory), { recursive: true })
    .some(file => /\.(?:ts|tsx|css)$/.test(String(file)))
}
for (const slice of slices) {
  const index = `apps/web/src/features/${slice}/index.ts`
  if (!exists(index)) failures.push(`missing feature public API: ${index}`)
  const legacyDirectory = `apps/web/src/components/${slice}`
  if (containsSourceFiles(legacyDirectory)) failures.push(`legacy component feature directory still exists: ${legacyDirectory}`)
}

const contractedBoundaries = [
  ['apps/server/src/modules/assignment/assignment.routes.ts', 'AssignmentContracts'],
  ['apps/server/src/modules/blog/blog.routes.ts', 'BlogDiscoveryContracts'],
  ['apps/server/src/modules/rating/rating-domain.routes.ts', 'ContestRatingContracts'],
  ['apps/server/src/modules/solution/solution.routes.ts', 'SolutionReviewContracts'],
  ['apps/web/src/features/assignment/ui/AssignmentWorkspace.tsx', 'setAssignmentManualCompletion'],
  ['apps/web/src/features/blog/ui/BlogDiscovery.tsx', 'listBlogDiscovery'],
  ['apps/web/src/features/blog/ui/BlogDiscoveryDetail.tsx', 'getBlogDiscovery'],
  ['apps/web/src/features/contest-rating/ui/TrainingRatingPanel.tsx', 'getContestRating'],
  ['apps/web/src/features/solution-review/ui/SolutionEditorialPanel.tsx', 'getSimilarityComparison'],
]
for (const [file, symbol] of contractedBoundaries) {
  if (!read(file).includes(symbol)) failures.push(`${file} bypasses ${symbol}`)
}

const appFiles = []
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) collect(absolute)
    else if (/\.(?:ts|tsx)$/.test(entry.name)) appFiles.push(absolute)
  }
}
collect(path.join(root, 'apps/web/src/app'))
for (const file of appFiles) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(root, file).replaceAll('\\', '/')
  if (/from ['"]@\/components\/(?:assignment|blog|submission)\//.test(source)) {
    failures.push(`${relative} bypasses a feature public API`)
  }
  if (/from ['"]@\/features\/(?:assignment|blog|contest-rating|solution-review|submission)\//.test(source)) {
    failures.push(`${relative} imports feature internals instead of its public index`)
  }
}

const featureFiles = []
collectFeature(path.join(root, 'apps/web/src/features'))
function collectFeature(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) collectFeature(absolute)
    else if (/\.(?:ts|tsx)$/.test(entry.name)) featureFiles.push(absolute)
  }
}
for (const file of featureFiles) {
  const source = fs.readFileSync(file, 'utf8')
  if (/\bany\b/.test(source)) {
    failures.push(`${path.relative(root, file).replaceAll('\\', '/')}: feature slices cannot use any`)
  }
}

console.log(JSON.stringify({
  sharedRuntimeContracts: failures.length === 0,
  contractFiles: contractFiles.length,
  featureSlices: slices.length,
  contractedBoundaries: contractedBoundaries.length,
  violations: failures,
}, null, 2))

if (failures.length) process.exitCode = 1
