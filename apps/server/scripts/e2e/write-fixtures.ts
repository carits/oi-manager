import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '../../../..')

async function required<T>(label: string, query: Promise<T | null>): Promise<T> {
  const value = await query
  if (!value) throw new Error(`Missing E2E fixture: ${label}`)
  return value
}

async function main() {
  const [
    superAdmin,
    platformAdmin,
    principal,
    teacher,
    campusStudent,
    personalStudent,
    school,
    team,
    personalTeam,
    problem,
    personalProblem,
    problemList,
    homework,
    contest,
    submission,
    personalSubmission,
  ] = await Promise.all([
    required('admin', prisma.user.findUnique({ where: { username: 'admin' } })),
    required('platform_admin', prisma.user.findUnique({ where: { username: 'platform_admin' } })),
    required('teacher1', prisma.user.findUnique({ where: { username: 'teacher1' } })),
    required('teacher2', prisma.user.findUnique({ where: { username: 'teacher2' } })),
    required('student1', prisma.user.findUnique({ where: { username: 'student1' } })),
    required('personal_student1', prisma.user.findUnique({ where: { username: 'personal_student1' } })),
    required('school-default', prisma.school.findUnique({ where: { id: 'school-default' } })),
    required('team', prisma.team.findUnique({ where: { id: 'e2e-team' } })),
    required('personal team', prisma.team.findUnique({ where: { id: 'e2e-personal-team' } })),
    required('problem', prisma.problem.findFirst({ orderBy: { createdAt: 'asc' } })),
    required('personal problem', prisma.problem.findUnique({ where: { id: 'e2e-personal-problem' } })),
    required('problem list', prisma.problemList.findFirst({ orderBy: { createdAt: 'asc' } })),
    required('homework', prisma.training.findFirst({ where: { type: 'homework' }, orderBy: { id: 'asc' } })),
    required('contest', prisma.training.findFirst({ where: { type: 'contest' }, orderBy: { id: 'asc' } })),
    required('submission', prisma.submission.findFirst({ orderBy: { createdAt: 'asc' } })),
    required('personal submission', prisma.submission.findFirst({
      where: { userId: 'e2e-personal-student', submitScope: 'problem' },
    })),
  ])

  const output = {
    users: {
      superAdmin: superAdmin.id,
      platformAdmin: platformAdmin.id,
      principal: principal.id,
      teacher: teacher.id,
      campusStudent: campusStudent.id,
      personalStudent: personalStudent.id,
    },
    school: school.id,
    team: team.id,
    personalTeam: personalTeam.id,
    problem: problem.id,
    personalProblem: personalProblem.id,
    problemList: problemList.id,
    homework: String(homework.id),
    contest: String(contest.id),
    submission: String(submission.id),
    personalSubmission: String(personalSubmission.id),
  }

  const outputDir = path.join(rootDir, 'test-results')
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(
    path.join(outputDir, 'e2e-fixtures.json'),
    `${JSON.stringify(output, null, 2)}\n`,
    'utf8',
  )
}

main()
  .finally(async () => prisma.$disconnect())
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
