/**
 * 组织模型迁移任务。
 *
 * 默认只做演练并输出审计报告；只有 --apply 才会补齐能够唯一映射的组织、
 * 成员关系和组织档案。任务不执行 SQL，也不会删除旧字段或旧表。
 */
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const apply = process.argv.includes('--apply')

type Issue = { code: string; entity: string; id: string; detail: string }
const issues: Issue[] = []
const counters = new Map<string, number>()

function count(name: string, amount = 1) {
  counters.set(name, (counters.get(name) || 0) + amount)
}

function fail(code: string, entity: string, id: string, detail: string) {
  issues.push({ code, entity, id, detail })
}

async function inspect() {
  const schools = await prisma.school.findMany({
    select: { id: true, name: true, organizationId: true, currentPrincipalTeacherId: true },
  })
  const schoolIds = new Set(schools.map((row) => row.id))
  const [students, teachers, teams, trainings, problems, lists, schoolLists, admins, principalLogs] = await Promise.all([
    prisma.student.findMany({ select: { id: true, schoolId: true, name: true, headTeacherId: true, enrollmentYear: true, targetContest: true, tags: true, notes: true, avatar: true, rating: true } }),
    prisma.teacher.findMany({ select: { id: true, schoolId: true, name: true, email: true, phone: true, avatar: true, bio: true, title: true, status: true } }),
    prisma.team.findMany({ where: { schoolId: { not: null } }, select: { id: true, schoolId: true } }),
    prisma.training.findMany({ where: { schoolId: { not: null } }, select: { id: true, schoolId: true } }),
    prisma.problem.findMany({ where: { schoolId: { not: null } }, select: { id: true, schoolId: true } }),
    prisma.problemList.findMany({ where: { schoolId: { not: null } }, select: { id: true, schoolId: true } }),
    prisma.schoolProblemList.findMany({ select: { id: true, schoolId: true } }),
    prisma.admin.findMany({ select: { id: true, schoolId: true } }),
    prisma.principalTransferLog.findMany({ select: { id: true, schoolId: true } }),
  ])
  count('学校', schools.length)
  for (const school of schools) if (!school.organizationId) fail('SCHOOL_ORGANIZATION_MISSING', 'School', school.id, '学校尚未关联组织')

  const teacherKeys = new Set(teachers.map((row) => row.schoolId + ':' + row.id))
  const studentKeys = new Set(students.map((row) => row.schoolId + ':' + row.id))
  for (const key of studentKeys) if (teacherKeys.has(key)) fail('MEMBERSHIP_ROLE_CONFLICT', 'User', key, '同一账号在同一学校同时存在学生和教师档案')
  for (const student of students) {
    count('旧学生档案')
    if (!schoolIds.has(student.schoolId)) fail('STUDENT_SCHOOL_UNMAPPABLE', 'Student', student.id, '学生学校不存在')
    if (student.headTeacherId && !teacherKeys.has(student.schoolId + ':' + student.headTeacherId)) fail('HEAD_TEACHER_UNMAPPABLE', 'Student', student.id, '主教练不属于同一学校')
  }
  for (const teacher of teachers) {
    count('旧教师档案')
    if (!schoolIds.has(teacher.schoolId)) fail('TEACHER_SCHOOL_UNMAPPABLE', 'Teacher', teacher.id, '教师学校不存在')
  }
  for (const school of schools) {
    if (!teacherKeys.has(school.id + ':' + school.currentPrincipalTeacherId)) fail('PRINCIPAL_UNMAPPABLE', 'School', school.id, '负责人不是本校教师')
  }
  const resources: Array<[string, Array<{ id: string; schoolId: string | null }>]> = [
    ['Team', teams], ['Training', trainings], ['Problem', problems], ['ProblemList', lists],
    ['SchoolProblemList', schoolLists], ['Admin', admins], ['PrincipalTransferLog', principalLogs],
  ]
  for (const [entity, rows] of resources) {
    count(entity, rows.length)
    for (const row of rows) if (!row.schoolId || !schoolIds.has(row.schoolId)) fail('RESOURCE_SCHOOL_UNMAPPABLE', entity, row.id, '资源学校不存在')
  }
  return { schools, students, teachers }
}

async function writeCanonical(input: Awaited<ReturnType<typeof inspect>>) {
  if (issues.some((item) => item.code !== 'SCHOOL_ORGANIZATION_MISSING')) throw new Error('审计存在阻塞项，拒绝执行写入')
  const organizationBySchool = new Map<string, string>()
  for (const school of input.schools) {
    const organizationId = school.organizationId || 'org_' + school.id
    await prisma.$transaction(async (tx) => {
      await tx.organization.upsert({
        where: { id: organizationId },
        create: { id: organizationId, name: school.name, type: 'school', status: 'active' },
        update: { name: school.name, type: 'school' },
      })
      if (school.organizationId !== organizationId) await tx.school.update({ where: { id: school.id }, data: { organizationId } })
    })
    organizationBySchool.set(school.id, organizationId)
    count('已确认组织')
  }
  const teacherMemberships = new Map<string, string>()
  for (const teacher of input.teachers) {
    const organizationId = organizationBySchool.get(teacher.schoolId)
    if (!organizationId) throw new Error('教师缺少组织映射: ' + teacher.id)
    const school = input.schools.find((item) => item.id === teacher.schoolId)
    const membership = await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId, userId: teacher.id } },
      create: { id: crypto.randomUUID(), organizationId, userId: teacher.id, memberRole: school?.currentPrincipalTeacherId === teacher.id ? 'school_principal' : 'teacher', relationType: 'employee', status: 'active', joinedAt: new Date() },
      update: { memberRole: school?.currentPrincipalTeacherId === teacher.id ? 'school_principal' : 'teacher', relationType: 'employee', status: 'active' },
    })
    await prisma.organizationTeacherProfile.upsert({
      where: { membershipId: membership.id },
      create: { id: crypto.randomUUID(), membershipId: membership.id, name: teacher.name, email: teacher.email, phone: teacher.phone, avatar: teacher.avatar, bio: teacher.bio, title: teacher.title, status: teacher.status },
      update: { name: teacher.name, email: teacher.email, phone: teacher.phone, avatar: teacher.avatar, bio: teacher.bio, title: teacher.title, status: teacher.status },
    })
    teacherMemberships.set(teacher.schoolId + ':' + teacher.id, membership.id)
    count('已迁移教师档案')
  }
  for (const student of input.students) {
    const organizationId = organizationBySchool.get(student.schoolId)
    if (!organizationId) throw new Error('学生缺少组织映射: ' + student.id)
    const membership = await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId, userId: student.id } },
      create: { id: crypto.randomUUID(), organizationId, userId: student.id, memberRole: 'student', relationType: 'enrolled', status: 'active', joinedAt: new Date() },
      update: { memberRole: 'student', relationType: 'enrolled', status: 'active' },
    })
    await prisma.organizationStudentProfile.upsert({
      where: { membershipId: membership.id },
      create: { id: crypto.randomUUID(), membershipId: membership.id, name: student.name, enrollmentYear: student.enrollmentYear, targetContest: student.targetContest, headTeacherMembershipId: student.headTeacherId ? teacherMemberships.get(student.schoolId + ':' + student.headTeacherId) || null : null, tags: student.tags, notes: student.notes, avatar: student.avatar, rating: student.rating },
      update: { name: student.name, enrollmentYear: student.enrollmentYear, targetContest: student.targetContest, headTeacherMembershipId: student.headTeacherId ? teacherMemberships.get(student.schoolId + ':' + student.headTeacherId) || null : null, tags: student.tags, notes: student.notes, avatar: student.avatar, rating: student.rating },
    })
    count('已迁移学生档案')
  }
}

async function main() {
  const input = await inspect()
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    generatedAt: new Date().toISOString(),
    counters: Object.fromEntries(counters),
    blockingIssueCount: issues.length,
    issues,
  }, null, 2))
  if (!apply) {
    if (issues.length) process.exitCode = 2
    return
  }
  await writeCanonical(input)
  console.log(JSON.stringify({ mode: 'apply', result: 'completed', counters: Object.fromEntries(counters) }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => prisma.$disconnect())
