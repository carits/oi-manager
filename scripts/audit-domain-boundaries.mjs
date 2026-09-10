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

console.log(JSON.stringify({
  assignmentAuthorizationBoundary: !violations.some(item => item.startsWith('Assignment')),
  contestProjectionBoundary: !violations.some(item => item.includes('Contest projection')),
  localJudgeResultWriteBoundary: !violations.some(item => item.startsWith('JudgeRun')),
  violations,
}, null, 2))

if (violations.length) process.exitCode = 1
