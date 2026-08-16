import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const apply = process.argv.includes('--apply')
type Issue = { entity: string; id: string; reason: string }
const issues: Issue[] = []
const counters = new Map<string, number>()
const count = (name: string) => counters.set(name, (counters.get(name) || 0) + 1)
const fail = (entity: string, id: string, reason: string) => issues.push({ entity, id, reason })

async function studentProfileFor(organizationId: string | null | undefined, userId: string) {
  if (!organizationId) return null
  return prisma.organizationStudentProfile.findFirst({
    where: { Membership: { organizationId, userId, status: 'active' } },
    select: { id: true, name: true, Membership: { select: { id: true, User: { select: { username: true } } } } },
  })
}

async function teacherMembershipFor(organizationId: string | null | undefined, userId: string | null | undefined) {
  if (!organizationId || !userId) return null
  return prisma.organizationMembership.findFirst({
    where: { organizationId, userId, status: 'active', TeacherProfile: { isNot: null } },
    select: { id: true, TeacherProfile: { select: { name: true } } },
  })
}

async function inspectAndApply() {
  const scores = await prisma.contestProblemScore.findMany({ include: { Student: { include: { User: { select: { username: true } } } }, Contest: { include: { Team: { select: { organizationId: true } } } } } })
  for (const row of scores) {
    count('contestProblemScores')
    const profile = await studentProfileFor(row.Contest.Team?.organizationId, row.studentId)
    if (!profile) { fail('ContestProblemScore', row.id, 'student profile cannot be mapped from contest organization'); continue }
    if (apply) await prisma.contestProblemScore.update({ where: { id: row.id }, data: { studentProfileId: profile.id, studentNameSnapshot: row.Student.name, usernameSnapshot: row.Student.User.username } })
  }

  const results = await prisma.contestResult.findMany({ include: { Student: { include: { User: { select: { username: true } } } }, Contest: { include: { Team: { select: { organizationId: true } } } } } })
  for (const row of results) {
    count('contestResults')
    const profile = await studentProfileFor(row.Contest.Team?.organizationId, row.studentId)
    if (!profile) { fail('ContestResult', row.id, 'student profile cannot be mapped from contest organization'); continue }
    if (apply) await prisma.contestResult.update({ where: { id: row.id }, data: { studentProfileId: profile.id, studentNameSnapshot: row.Student.name, usernameSnapshot: row.Student.User.username } })
  }

  const milestones = await prisma.milestone.findMany({ include: { Student: true, Teacher: true } })
  for (const row of milestones) {
    count('milestones')
    if (row.Student.schoolId !== row.Teacher.schoolId) { fail('Milestone', row.id, 'student and teacher schools differ'); continue }
    const school = await prisma.school.findUnique({ where: { id: row.Student.schoolId }, select: { organizationId: true } })
    const student = await studentProfileFor(school?.organizationId, row.studentId)
    const teacher = await teacherMembershipFor(school?.organizationId, row.teacherId)
    if (!student || !teacher?.TeacherProfile) { fail('Milestone', row.id, 'student or teacher profile cannot be mapped'); continue }
    if (apply) await prisma.milestone.update({ where: { id: row.id }, data: { studentMembershipId: student.Membership.id, teacherMembershipId: teacher.id, studentNameSnapshot: row.Student.name, teacherNameSnapshot: row.Teacher.name } })
  }

  const externalAccounts = await prisma.teamMemberExternalAccount.findMany({ include: { Team: { select: { organizationId: true } }, Student: true } })
  for (const row of externalAccounts) {
    count('externalAccounts')
    if (!row.studentId) continue
    const profile = await studentProfileFor(row.Team.organizationId, row.studentId)
    if (!profile) { fail('TeamMemberExternalAccount', row.id, 'student profile cannot be mapped from team organization'); continue }
    if (apply) await prisma.teamMemberExternalAccount.update({ where: { id: row.id }, data: { studentProfileId: profile.id, studentNameSnapshot: row.Student?.name || profile.name } })
  }

  const importItems = await prisma.teamMemberImportItem.findMany({ include: { TeamMemberImportBatch: { include: { Team: { select: { organizationId: true } } } } } })
  for (const row of importItems) {
    count('teamMemberImportItems')
    const organizationId = row.TeamMemberImportBatch.Team?.organizationId
    const matched = row.matchedStudentId ? await studentProfileFor(organizationId, row.matchedStudentId) : null
    const created = row.createdStudentId ? await studentProfileFor(organizationId, row.createdStudentId) : null
    if (row.matchedStudentId && !matched) { fail('TeamMemberImportItem', row.id, 'matched student profile cannot be mapped from team organization'); continue }
    if (row.createdStudentId && !created) { fail('TeamMemberImportItem', row.id, 'created student profile cannot be mapped from team organization'); continue }
    if (apply && (matched || created)) await prisma.teamMemberImportItem.update({ where: { id: row.id }, data: { matchedStudentProfileId: matched?.id, createdStudentProfileId: created?.id, matchedStudentName: row.matchedStudentName || matched?.name || null } })
  }

  const transfers = await prisma.principalTransferLog.findMany({ include: { School: { select: { organizationId: true } } } })
  for (const row of transfers) {
    count('principalTransferLogs')
    const organizationId = row.organizationId || row.School.organizationId
    const oldTeacher = row.oldPrincipalTeacherId ? await prisma.teacher.findUnique({ where: { id: row.oldPrincipalTeacherId }, select: { userId: true, name: true } }) : null
    const newTeacher = await prisma.teacher.findUnique({ where: { id: row.newPrincipalTeacherId }, select: { userId: true, name: true } })
    const oldMembership = oldTeacher ? await teacherMembershipFor(organizationId, oldTeacher.userId) : null
    const newMembership = await teacherMembershipFor(organizationId, newTeacher?.userId)
    if ((row.oldPrincipalTeacherId && !oldMembership) || !newTeacher || !newMembership) { fail('PrincipalTransferLog', row.id, 'former or new principal membership cannot be mapped'); continue }
    if (apply) await prisma.principalTransferLog.update({ where: { id: row.id }, data: { organizationId: organizationId || null, oldPrincipalMembershipId: oldMembership?.id || null, newPrincipalMembershipId: newMembership.id, oldPrincipalNameSnapshot: oldTeacher?.name || null, newPrincipalNameSnapshot: newTeacher.name } })
  }
}

async function main() {
  await inspectAndApply()
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', counters: Object.fromEntries(counters), blockingIssueCount: issues.length, issues }, null, 2))
  if (issues.length) process.exitCode = 2
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
