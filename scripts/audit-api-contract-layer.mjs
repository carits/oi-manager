import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
const exists = relative => fs.existsSync(path.join(root, relative))
const failures = []

// Temporary migration ledger for legacy page/component transport calls. New
// direct transport is forbidden and every completed feature slice must reduce
// or remove its allowance. The target state is an empty object.
const legacyTransportAllowances = {
  'apps/web/src/components/organization-pages/teacher/school/components/TeachersTab.tsx': 6,
  'apps/web/src/components/management/StudentsManagementContent.tsx': 5,
  'apps/web/src/app/admin/schools/page.tsx': 5,
  'apps/web/src/app/admin/schools/[id]/edit/page.tsx': 5,
  'apps/web/src/app/admin/schools/[id]/page.tsx': 3,
  'apps/web/src/components/business/UserManagement.tsx': 2,
  'apps/web/src/app/admin/users/page.tsx': 2,
  'apps/web/src/app/platform-admin/users/page.tsx': 2,
  'apps/web/src/components/organization-pages/teacher/management/page.tsx': 2,
  'apps/web/src/components/team-import/ImportPreview.tsx': 1,
  'apps/web/src/app/admin/schools/new/page.tsx': 1,
  'apps/web/src/app/admin/users/new-platform-admin/page.tsx': 1,
  'apps/web/src/components/organization-pages/teacher/school/components/HomeTab.tsx': 1,
  'apps/web/src/components/organization-pages/teacher/school/components/EditSchoolModal.tsx': 1,
  'apps/web/src/components/ui/PasswordResetModal.tsx': 1,
  'apps/web/src/components/telemetry/ClientTelemetry.tsx': 1,
  'apps/web/src/components/feature/PlannedFeaturePage.tsx': 1,
  'apps/web/src/components/campus/OrganizationCampusPage.tsx': 1,
  'apps/web/src/app/admin/users/[id]/page.tsx': 1,
}
const legacyFeatureTransportAllowances = {
  'apps/web/src/features/training-session/ui/TrainingSessionWorkspace.tsx': 18,
  'apps/web/src/features/contest-rating/ui/TrainingRatingPanel.tsx': 3,
  'apps/web/src/features/training-session/ui/TrainingSessionListPage.tsx': 10,
  'apps/web/src/features/contest-rating/rating-workspace.test.ts': 1,
  'apps/web/src/features/training-session/ui/TrainingSessionDesigner.tsx': 3,
  'apps/web/src/features/team/ui/TeamProblemListsTab.tsx': 4,
  'apps/web/src/features/blog/ui/ProblemRelatedBlogs.tsx': 1,
  'apps/web/src/features/blog/ui/BlogWorkspace.tsx': 11,
  'apps/web/src/features/blog/ui/BlogSeriesManager.tsx': 5,
  'apps/web/src/features/blog/ui/BlogReferenceEditor.tsx': 3,
  'apps/web/src/features/blog/ui/BlogModerationWorkbench.tsx': 4,
  'apps/web/src/features/blog/ui/BlogListPage.tsx': 1,
  'apps/web/src/features/contest/ui/TrainingStatementManagementPage.tsx': 2,
  'apps/web/src/features/blog/ui/BlogCommunityPanel.tsx': 10,
  'apps/web/src/features/contest/ui/TrainingFormModal.tsx': 22,
  'apps/web/src/features/contest/ui/TrainingDetailPage.tsx': 2,
  'apps/web/src/features/chat/ui/ChatReportWorkbench.tsx': 3,
  'apps/web/src/features/team/ui/TeamActivityOverview.tsx': 3,
  'apps/web/src/features/training-session/ui/TrainingDesignAuxiliary.tsx': 4,
  'apps/web/src/features/assignment/ui/AssignmentListPage.tsx': 1,
  'apps/web/src/features/submission/model/useSubmissionDetail.ts': 2,
  'apps/web/src/features/solution-review/ui/SolutionEditorialPanel.tsx': 13,
  'apps/web/src/features/problem/ui/JudgeSettingsTab.tsx': 4,
  'apps/web/src/features/problem/ui/NewProblemListPage.tsx': 1,
  'apps/web/src/features/problem/ui/JudgeProgramWizard.tsx': 11,
  'apps/web/src/features/problem/ui/ProblemHackConfigPanel.tsx': 2,
  'apps/web/src/features/problem/ui/ProblemForm.tsx': 9,
  'apps/web/src/features/problem/ui/ProblemDetail.tsx': 9,
  'apps/web/src/features/problem/ui/ProblemHackPanel.tsx': 8,
  'apps/web/src/features/problem/ui/ProblemNote.tsx': 3,
  'apps/web/src/features/problem/ui/ProblemListPage.tsx': 1,
  'apps/web/src/features/problem/ui/UserProblemContentPanel.tsx': 5,
  'apps/web/src/features/problem/ui/ProblemListDetailPage.tsx': 18,
  'apps/web/src/features/problem/ui/ProblemList.tsx': 1,
  'apps/web/src/features/problem/ui/StatementVersionWorkspace.tsx': 8,
  'apps/web/src/features/problem/ui/ProblemJudgeAssetsPanel.tsx': 19,
  'apps/web/src/features/problem/ui/ProblemTestGraphPanel.tsx': 2,
  'apps/web/src/features/problem/ui/ProblemQualityPanel.tsx': 6,
  'apps/web/src/features/assignment/ui/AssignmentWorkspace.tsx': 8,
  'apps/web/src/features/contest/ui/components/TrainingContentSelectionModal.tsx': 3,
  'apps/web/src/features/contest/ui/components/TrainingHackSyncAction.tsx': 2,
  'apps/web/src/features/contest/ui/components/TrainingContentSnapshotEditorModal.tsx': 2,
  'apps/web/src/features/contest/ui/components/TrainingRankingSubmissionsModal.tsx': 1,
  'apps/web/src/features/contest/ui/components/TrainingRejudgeModal.tsx': 2,
}
const directTransportPattern = /\bapiClient\.(?:get|post|put|patch|delete|query|mutate)(?:Contract)?\b/g

const contractFiles = [
  'packages/contracts/src/http.ts',
  'packages/contracts/src/auth.ts',
  'packages/contracts/src/ai-governance.ts',
  'packages/contracts/src/health.ts',
  'packages/contracts/src/identity.ts',
  'packages/contracts/src/organization.ts',
  'packages/contracts/src/notification.ts',
  'packages/contracts/src/oj-fetcher.ts',
  'packages/contracts/src/oj-account.ts',
  'packages/contracts/src/platform-binding.ts',
  'packages/contracts/src/problem.ts',
  'packages/contracts/src/ranking.ts',
  'packages/contracts/src/assignment.ts',
  'packages/contracts/src/blog.ts',
  'packages/contracts/src/chat.ts',
  'packages/contracts/src/carits.ts',
  'packages/contracts/src/contribution.ts',
  'packages/contracts/src/data-market.ts',
  'packages/contracts/src/evaluation-credits.ts',
  'packages/contracts/src/rating.ts',
  'packages/contracts/src/solution-review.ts',
  'packages/contracts/src/team.ts',
  'packages/contracts/src/training.ts',
  'packages/contracts/src/workspace.ts',
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
  { name: 'organization-account', legacyDirectory: 'organization-account', allowedAnyTokens: 0 },
  { name: 'notification', legacyDirectory: 'notification', allowedAnyTokens: 0 },
  { name: 'workspace', legacyDirectory: 'workspace', allowedAnyTokens: 0 },
  { name: 'auth', legacyDirectory: null, allowedAnyTokens: 0 },
  { name: 'user-profile', legacyDirectory: 'profile', allowedAnyTokens: 0 },
  { name: 'team', legacyDirectory: 'team', allowedAnyTokens: 0 },
  { name: 'data-market', legacyDirectory: 'data-market', allowedAnyTokens: 0 },
  { name: 'carits', legacyDirectory: null, allowedAnyTokens: 0 },
  { name: 'evaluation-credits', legacyDirectory: null, allowedAnyTokens: 0 },
  { name: 'account-wallet', legacyDirectory: 'wallet', allowedAnyTokens: 0 },
  { name: 'contribution', legacyDirectory: 'contribution', allowedAnyTokens: 0 },
  { name: 'platform-binding', legacyDirectory: null, allowedAnyTokens: 0 },
  { name: 'ranking', legacyDirectory: 'ranking', allowedAnyTokens: 0 },
  { name: 'ai-governance', legacyDirectory: null, allowedAnyTokens: 0 },
  { name: 'oj-account', legacyDirectory: null, allowedAnyTokens: 0 },
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
  if (slice.legacyDirectory) {
    const legacyDirectory = `apps/web/src/components/${slice.legacyDirectory}`
    if (containsSourceFiles(legacyDirectory)) failures.push(`legacy component feature directory still exists: ${legacyDirectory}`)
  }
}
for (const retiredAuthFile of [
  'apps/web/src/components/AuthProvider.tsx',
  'apps/web/src/app/login/LoginForm.tsx',
  'apps/web/src/components/profile/ProfileEditor.tsx',
  'apps/web/src/components/profile/PasswordEditor.tsx',
]) {
  if (exists(retiredAuthFile)) failures.push(`legacy auth implementation still exists: ${retiredAuthFile}`)
}

const contractedBoundaries = [
  ['apps/server/src/modules/assignment/assignment.routes.ts', 'AssignmentContracts'],
  ['apps/server/src/modules/blog/blog.routes.ts', 'BlogDiscoveryContracts'],
  ['apps/server/src/modules/rating/rating-domain.routes.ts', 'ContestRatingContracts'],
  ['apps/server/src/modules/solution/solution.routes.ts', 'SolutionReviewContracts'],
  ['apps/server/src/modules/training-engine/training-engine.routes.ts', 'TrainingContracts'],
  ['apps/server/src/modules/problem/problem.judge.routes.ts', 'ProblemContracts'],
  ['apps/server/src/modules/problem/problem.crud.routes.ts', 'ProblemContracts'],
  ['apps/server/src/routes/oj-fetcher.ts', 'OjFetcherContracts'],
  ['apps/server/src/routes/oj-accounts.ts', 'OjAccountContracts'],
  ['apps/server/src/modules/problem/problem.testset-revision.routes.ts', 'ProblemContracts'],
  ['apps/server/src/modules/problem/problem.test-graph.routes.ts', 'ProblemContracts'],
  ['apps/server/src/modules/problem/problem.judge-program.routes.ts', 'ProblemContracts'],
  ['apps/server/src/modules/chat/chat.routes.ts', 'ChatContracts'],
  ['apps/server/src/modules/organization-join/organization-join.routes.ts', 'OrganizationContracts'],
  ['apps/server/src/routes/organization-members.ts', 'OrganizationContracts'],
  ['apps/server/src/modules/organization-creation/organization-creation.routes.ts', 'OrganizationContracts'],
  ['apps/server/src/modules/notification/notification.routes.ts', 'NotificationContracts'],
  ['apps/server/src/routes/workspaces.ts', 'WorkspaceContracts'],
  ['apps/server/src/routes/auth.ts', 'AuthContracts'],
  ['apps/server/src/routes/users.ts', 'IdentityContracts'],
  ['apps/server/src/routes/testdata.ts', 'ProblemContracts'],
  ['apps/server/src/modules/team/team.crud.routes.ts', 'TeamContracts'],
  ['apps/server/src/modules/team/team.members.routes.ts', 'TeamContracts'],
  ['apps/server/src/modules/team/team.requests.routes.ts', 'TeamContracts'],
  ['apps/server/src/modules/team/team.invitations.routes.ts', 'TeamContracts'],
  ['apps/server/src/modules/data-market/data-market.routes.ts', 'DataMarketContracts'],
  ['apps/server/src/modules/carits/carits.routes.ts', 'CaritsContracts'],
  ['apps/server/src/modules/carits/resource.routes.ts', 'EvaluationCreditContracts'],
  ['apps/server/src/modules/contribution/contribution.routes.ts', 'ContributionContracts'],
  ['apps/server/src/modules/platform-binding/platform-binding.routes.ts', 'PlatformBindingContracts'],
  ['apps/server/src/modules/ranking/ranking.routes.ts', 'RankingContracts'],
  ['apps/server/src/modules/ai/ai-token.routes.ts', 'AiGovernanceContracts'],
  ['apps/server/src/modules/rating/rating-domain.routes.ts', 'RatingLeaderboardContracts'],
  ['apps/server/src/modules/rating/rating-domain.routes.ts', 'RatingAccountContracts'],
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
  ['apps/web/src/features/problem/api/platformProblemAdminApi.ts', 'OjFetcherContracts'],
  ['apps/web/src/features/problem/api/platformProblemAdminApi.ts', 'ProblemContracts'],
  ['apps/web/src/features/problem/api/problemTestGraphApi.ts', 'ProblemContracts'],
  ['apps/web/src/features/problem/api/judgeProgramTemplateApi.ts', 'ProblemContracts'],
  ['apps/web/src/features/problem/ui/ProblemForm.tsx', 'getProblemEditorDetail'],
  ['apps/web/src/features/problem/ui/ProblemForm.tsx', 'updateProblem'],
  ['apps/web/src/features/problem/ui/PlatformProblemManagementPage.tsx', 'listOjFetchJobs'],
  ['apps/web/src/features/problem/ui/PlatformProblemManagementPage.tsx', 'listPlatformManagedProblems'],
  ['apps/web/src/features/oj-account/api/ojAccountApi.ts', 'OjAccountContracts'],
  ['apps/web/src/features/oj-account/ui/OjAccountManagementPage.tsx', 'listOjAccounts'],
  ['apps/web/src/features/oj-account/ui/OjAccountManagementPage.tsx', 'createOjAccount'],
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
  ['apps/web/src/features/organization-account/api/organizationAccountApi.ts', 'OrganizationContracts'],
  ['apps/web/src/features/organization-account/ui/PersonalOrganizationsPage.tsx', 'getMyOrganizations'],
  ['apps/web/src/features/organization-account/ui/PersonalOrganizationsPage.tsx', 'createOrganizationJoinApplication'],
  ['apps/web/src/features/organization-account/ui/PersonalOrganizationsPage.tsx', 'createOrganizationApplication'],
  ['apps/web/src/features/organization-account/ui/OrganizationJoinManagement.tsx', 'getOrganizationJoinApplications'],
  ['apps/web/src/features/organization-account/ui/OrganizationJoinManagement.tsx', 'createOrganizationInvitation'],
  ['apps/web/src/features/organization-account/ui/OrganizationJoinManagement.tsx', 'updateOrganizationJoinPolicy'],
  ['apps/web/src/features/notification/api/notificationApi.ts', 'NotificationContracts'],
  ['apps/web/src/features/notification/ui/NotificationBell.tsx', 'listContextNotifications'],
  ['apps/web/src/features/notification/ui/NotificationCenterPage.tsx', 'listAccountNotifications'],
  ['apps/web/src/features/workspace/api/workspaceApi.ts', 'WorkspaceContracts'],
  ['apps/web/src/features/workspace/ui/IdentityChooser.tsx', 'listWorkspaces'],
  ['apps/web/src/features/workspace/ui/WorkspaceSwitcher.tsx', 'listWorkspaces'],
  ['apps/web/src/features/auth/api/authApi.ts', 'AuthContracts'],
  ['apps/web/src/features/auth/model/AuthProvider.tsx', 'loadCurrentAccount'],
  ['apps/web/src/features/auth/ui/ProfileEditor.tsx', 'updateAccountProfile'],
  ['apps/web/src/features/auth/ui/PasswordEditor.tsx', 'changeAccountPassword'],
  ['apps/web/src/features/user-profile/api/userProfileApi.ts', 'IdentityContracts'],
  ['apps/web/src/features/user-profile/ui/UserProfilePage.tsx', 'getPublicUserProfile'],
  ['apps/web/src/features/team/api/teamApi.ts', 'TeamContracts'],
  ['apps/web/src/features/team/ui/TeamDetailPage.tsx', 'useTeamDetail'],
  ['apps/web/src/features/team/ui/TeamInviteModal.tsx', 'inviteTeamMembers'],
  ['apps/web/src/features/data-market/api/dataMarketApi.ts', 'DataMarketContracts'],
  ['apps/web/src/features/data-market/ui/DataMarketplace.tsx', 'listDataProducts'],
  ['apps/web/src/features/carits/api/caritsApi.ts', 'CaritsContracts'],
  ['apps/web/src/features/evaluation-credits/api/evaluationCreditsApi.ts', 'EvaluationCreditContracts'],
  ['apps/web/src/features/account-wallet/ui/WalletPage.tsx', 'getPersonalCaritsTransactions'],
  ['apps/web/src/features/account-wallet/ui/WalletPage.tsx', 'getEvaluationCreditOverview'],
  ['apps/web/src/features/contribution/api/contributionApi.ts', 'ContributionContracts'],
  ['apps/web/src/features/contribution/ui/ContributionPage.tsx', 'listMyContributionEvents'],
  ['apps/web/src/features/contribution/ui/PlatformContributionPage.tsx', 'listContributionAudit'],
  ['apps/web/src/features/platform-binding/api/platformBindingApi.ts', 'PlatformBindingContracts'],
  ['apps/web/src/features/platform-binding/ui/PlatformBindingsPage.tsx', 'listPlatformBindings'],
  ['apps/web/src/features/ranking/api/rankingApi.ts', 'RankingContracts'],
  ['apps/web/src/features/ranking/api/rankingApi.ts', 'RatingLeaderboardContracts'],
  ['apps/web/src/features/ranking/api/rankingApi.ts', 'ContributionContracts'],
  ['apps/web/src/features/ranking/api/rankingApi.ts', 'RatingAccountContracts'],
  ['apps/web/src/features/ranking/ui/MetricRankingWorkspace.tsx', 'getMetricRanking'],
  ['apps/web/src/features/ai-governance/api/aiGovernanceApi.ts', 'AiGovernanceContracts'],
  ['apps/web/src/features/ai-governance/ui/PlatformAiGovernancePage.tsx', 'getAiTokenUsage'],
  ['apps/web/src/features/ai-governance/ui/PlatformAiGovernancePage.tsx', 'adjustAiTokenPool'],
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
  if (/from ['"]@\/components\/(?:assignment|blog|chat|data-market|wallet|submission|problem|team|training|training-engine)\//.test(source)) {
    failures.push(`${relative} bypasses a feature public API`)
  }
  if (/from ['"]@\/features\/(?:assignment|auth|user-profile|blog|chat|data-market|carits|evaluation-credits|account-wallet|contribution|platform-binding|ranking|ai-governance|organization-account|notification|workspace|contest-rating|solution-review|submission|problem|team|contest|training-session)\/(?:api|model|ui)\//.test(source)) {
    failures.push(`${relative} imports feature internals instead of its public index`)
  }
  const directCalls = source.match(directTransportPattern)?.length ?? 0
  const allowance = legacyTransportAllowances[relative] ?? 0
  if (directCalls > allowance) failures.push(`${relative} adds direct API transport (${directCalls} > legacy allowance ${allowance})`)
}

const componentFiles = []
collectComponents(path.join(root, 'apps/web/src/components'))
function collectComponents(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) collectComponents(absolute)
    else if (/\.(?:ts|tsx)$/.test(entry.name)) componentFiles.push(absolute)
  }
}
for (const file of componentFiles) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(root, file).replaceAll('\\', '/')
  const directCalls = source.match(directTransportPattern)?.length ?? 0
  const allowance = legacyTransportAllowances[relative] ?? 0
  if (directCalls > allowance) failures.push(`${relative} adds direct API transport (${directCalls} > legacy allowance ${allowance})`)
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

for (const file of featureFiles) {
  const relative = path.relative(root, file).replaceAll('\\', '/')
  if (relative.includes('/api/')) continue
  const directCalls = read(relative).match(directTransportPattern)?.length ?? 0
  const allowance = legacyFeatureTransportAllowances[relative] ?? 0
  if (directCalls > allowance) failures.push(`${relative} bypasses its Feature API transport boundary (${directCalls} > legacy allowance ${allowance})`)
}

const remainingLegacyTransportCalls = Object.entries(legacyTransportAllowances)
  .reduce((total, [file, allowance]) => {
    if (!exists(file)) return total
    return total + Math.min(read(file).match(directTransportPattern)?.length ?? 0, allowance)
  }, 0)
const remainingLegacyFeatureTransportCalls = Object.entries(legacyFeatureTransportAllowances)
  .reduce((total, [file, allowance]) => {
    if (!exists(file)) return total
    return total + Math.min(read(file).match(directTransportPattern)?.length ?? 0, allowance)
  }, 0)

console.log(JSON.stringify({
  sharedRuntimeContracts: failures.length === 0,
  contractFiles: contractFiles.length,
  featureSlices: slices.length,
  contractedBoundaries: contractedBoundaries.length,
  remainingLegacyTransportFiles: Object.keys(legacyTransportAllowances).filter(exists).length,
  remainingLegacyTransportCalls,
  remainingLegacyFeatureTransportFiles: Object.keys(legacyFeatureTransportAllowances).filter(exists).length,
  remainingLegacyFeatureTransportCalls,
  violations: failures,
}, null, 2))

if (failures.length) process.exitCode = 1
