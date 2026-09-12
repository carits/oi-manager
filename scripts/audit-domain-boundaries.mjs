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
if (!judgeRun.includes('holdContestFinalizationForRejudgeTx')) {
  violations.push('Judge rejudge finalization bypasses the Contest command service')
}

console.log(JSON.stringify({
  assignmentAuthorizationBoundary: !violations.some(item => item.startsWith('Assignment')),
  contestProjectionBoundary: !violations.some(item => item.includes('Contest projection')),
  contestQueryFacadeBoundary: !violations.some(item => item.includes('Contest query facade')),
  contestCommandBoundary: !violations.some(item => item.includes('Contest command service')),
  localJudgeResultWriteBoundary: !violations.some(item => item.startsWith('JudgeRun')),
  violations,
}, null, 2))

if (violations.length) process.exitCode = 1
