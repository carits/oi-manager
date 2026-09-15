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
  'packages/contracts/src/problem.ts',
  'packages/contracts/src/assignment.ts',
  'packages/contracts/src/blog.ts',
  'packages/contracts/src/chat.ts',
  'packages/contracts/src/rating.ts',
  'packages/contracts/src/solution-review.ts',
  'packages/contracts/src/training.ts',
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

const slices = [
  { name: 'assignment', legacyDirectory: 'assignment', allowedAnyTokens: 0 },
  { name: 'blog', legacyDirectory: 'blog', allowedAnyTokens: 0 },
  { name: 'contest-rating', legacyDirectory: 'contest-rating', allowedAnyTokens: 0 },
  { name: 'solution-review', legacyDirectory: 'solution-review', allowedAnyTokens: 0 },
  { name: 'submission', legacyDirectory: 'submission', allowedAnyTokens: 0 },
  { name: 'chat', legacyDirectory: 'chat', allowedAnyTokens: 0 },
  // These three slices physically absorb the pre-existing UI in this rollout.
  // Migrated slices are held to the same zero-any boundary as the original slices.
  { name: 'problem', legacyDirectory: 'problem', allowedAnyTokens: 0 },
  { name: 'contest', legacyDirectory: 'training', allowedAnyTokens: 0 },
  { name: 'training-session', legacyDirectory: 'training-engine', allowedAnyTokens: 0 },
]
function containsSourceFiles(directory) {
  if (!exists(directory)) return false
  return fs.readdirSync(path.join(root, directory), { recursive: true })
    .some(file => /\.(?:ts|tsx|css)$/.test(String(file)))
}
for (const slice of slices) {
  const index = `apps/web/src/features/${slice.name}/index.ts`
  if (!exists(index)) failures.push(`missing feature public API: ${index}`)
  const legacyDirectory = `apps/web/src/components/${slice.legacyDirectory}`
  if (containsSourceFiles(legacyDirectory)) failures.push(`legacy component feature directory still exists: ${legacyDirectory}`)
}

const contractedBoundaries = [
  ['apps/server/src/modules/assignment/assignment.routes.ts', 'AssignmentContracts'],
  ['apps/server/src/modules/blog/blog.routes.ts', 'BlogDiscoveryContracts'],
  ['apps/server/src/modules/rating/rating-domain.routes.ts', 'ContestRatingContracts'],
  ['apps/server/src/modules/solution/solution.routes.ts', 'SolutionReviewContracts'],
  ['apps/server/src/modules/training-engine/training-engine.routes.ts', 'TrainingContracts'],
  ['apps/server/src/modules/problem/problem.judge.routes.ts', 'ProblemContracts'],
  ['apps/server/src/modules/problem/problem.crud.routes.ts', 'ProblemContracts'],
  ['apps/server/src/modules/problem/problem.testset-revision.routes.ts', 'ProblemContracts'],
  ['apps/server/src/modules/problem/problem.test-graph.routes.ts', 'ProblemContracts'],
  ['apps/server/src/modules/problem/problem.judge-program.routes.ts', 'ProblemContracts'],
  ['apps/server/src/modules/chat/chat.routes.ts', 'ChatContracts'],
  ['apps/server/src/routes/testdata.ts', 'ProblemContracts'],
  ['apps/web/src/features/assignment/ui/AssignmentWorkspace.tsx', 'setAssignmentManualCompletion'],
  ['apps/web/src/features/blog/ui/BlogDiscovery.tsx', 'listBlogDiscovery'],
  ['apps/web/src/features/blog/ui/BlogDiscoveryDetail.tsx', 'getBlogDiscovery'],
  ['apps/web/src/features/contest-rating/ui/TrainingRatingPanel.tsx', 'getContestRating'],
  ['apps/web/src/features/solution-review/ui/SolutionEditorialPanel.tsx', 'getSimilarityComparison'],
  ['apps/web/src/features/training-session/ui/TrainingSessionDesigner.tsx', 'getTrainingDesign'],
  ['apps/web/src/features/training-session/ui/TrainingSessionDesigner.tsx', 'validateTrainingDesign'],
  ['apps/web/src/features/training-session/ui/TrainingSessionDesigner.tsx', 'saveTrainingDesign'],
  ['apps/web/src/features/problem/api/problemJudgeSettingsApi.ts', 'ProblemContracts'],
  ['apps/web/src/features/problem/api/problemEditorApi.ts', 'ProblemContracts'],
  ['apps/web/src/features/problem/api/problemTestGraphApi.ts', 'ProblemContracts'],
  ['apps/web/src/features/problem/api/judgeProgramTemplateApi.ts', 'ProblemContracts'],
  ['apps/web/src/features/problem/ui/ProblemForm.tsx', 'getProblemEditorDetail'],
  ['apps/web/src/features/problem/ui/ProblemForm.tsx', 'updateProblem'],
  ['apps/web/src/features/problem/ui/JudgeSettingsTab.tsx', 'getProblemJudgeSettings'],
  ['apps/web/src/features/problem/ui/JudgeSettingsTab.tsx', 'saveProblemJudgeSettings'],
  ['apps/web/src/features/problem/ui/JudgeSettingsTab.tsx', 'transitionProblemJudgeMode'],
  ['apps/web/src/features/problem/ui/ProblemTestGraphPanel.tsx', 'getProblemTestGraph'],
  ['apps/web/src/features/problem/ui/ProblemTestGraphPanel.tsx', 'saveProblemTestGraph'],
  ['apps/web/src/features/problem/ui/ProblemTestGraphPanel.tsx', 'registerProblemTestGraphTestcases'],
  ['apps/web/src/features/problem/ui/ProblemTestGraphPanel.tsx', 'setProblemTestGraphTestcaseProtection'],
  ['apps/web/src/features/problem/ui/ProblemTestGraphPanel.tsx', 'getProblemTestSetRevision'],
  ['apps/web/src/features/problem/ui/JudgeProgramTemplateGallery.tsx', 'getJudgeProgramTemplate'],
  ['apps/web/src/features/problem/ui/JudgeProgramWizard.tsx', 'getJudgeProgramTemplate'],
  ['apps/web/src/features/problem/ui/ProblemJudgeAssetsPanel.tsx', 'listJudgeProgramTemplates'],
  ['apps/web/src/features/chat/api/chatApi.ts', 'ChatContracts'],
  ['apps/web/src/features/chat/ui/ChatWorkspace.tsx', 'sendChatTextMessage'],
  ['apps/web/src/features/chat/ui/ChatWorkspace.tsx', 'sendChatStickerMessage'],
  ['apps/web/src/features/chat/model/ChatProvider.tsx', 'getChatUnread'],
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
  if (/from ['"]@\/components\/(?:assignment|blog|chat|submission|problem|training|training-engine)\//.test(source)) {
    failures.push(`${relative} bypasses a feature public API`)
  }
  if (/from ['"]@\/features\/(?:assignment|blog|chat|contest-rating|solution-review|submission|problem|contest|training-session)\/(?:api|model|ui)\//.test(source)) {
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
for (const slice of slices) {
  const prefix = path.join(root, 'apps/web/src/features', slice.name) + path.sep
  const count = featureFiles
    .filter(file => file.startsWith(prefix))
    .reduce((total, file) => total + (fs.readFileSync(file, 'utf8').match(/\bany\b/g)?.length ?? 0), 0)
  if (count > slice.allowedAnyTokens) {
    failures.push(`apps/web/src/features/${slice.name}: any debt increased from ${slice.allowedAnyTokens} to ${count}`)
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
