import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const ORGANIZATION_ID = 'org_school-default'
const SCHOOL_ID = 'school-default'
const PASSWORD = '123456'

const contestData = [
  { id: 'contest-1', title: '2024寒假训练赛第一场', date: '2024-01-15', type: 'training', countRating: false },
  { id: 'contest-2', title: '2024寒假训练赛第二场', date: '2024-01-22', type: 'training', countRating: false },
  { id: 'contest-3', title: '2024春季模拟赛第一场', date: '2024-02-15', type: 'mock', countRating: true },
  { id: 'contest-4', title: '2024春季模拟赛第二场', date: '2024-03-01', type: 'mock', countRating: true },
  { id: 'contest-5', title: '2024春季模拟赛第三场', date: '2024-03-15', type: 'mock', countRating: true },
  { id: 'contest-6', title: '2024省选模拟赛', date: '2024-04-01', type: 'official', countRating: true },
]

function userId(username: string) {
  return `seed-user-${username}`
}

function membershipId(username: string) {
  return `seed-membership-${username}`
}

async function upsertUser(username: string, role: string, passwordHash: string, extra: { phone?: string; email?: string } = {}) {
  return prisma.user.upsert({
    where: { username },
    update: { role, status: 'active' },
    create: {
      id: userId(username), username, passwordHash, role, status: 'active',
      phone: extra.phone, email: extra.email,
    },
  })
}

async function upsertMembership(username: string, role: 'school_principal' | 'teacher' | 'student') {
  return prisma.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: ORGANIZATION_ID, userId: userId(username) } },
    update: { memberRole: role, relationType: role === 'student' ? 'student' : 'employee', status: 'active' },
    create: {
      id: membershipId(username), organizationId: ORGANIZATION_ID, userId: userId(username),
      memberRole: role, relationType: role === 'student' ? 'student' : 'employee',
      status: 'active', joinedAt: new Date(),
    },
  })
}

async function upsertTeacher(username: string, name: string, title: string, passwordHash: string, role: 'school_principal' | 'teacher' = 'teacher') {
  const index = Number(username.replace(/\D/g, '')) || 1
  await upsertUser(username, role, passwordHash, {
    phone: `1390000000${index - 1}`,
    email: `${username}@example.com`,
  })
  const membership = await upsertMembership(username, role)
  await prisma.organizationTeacherProfile.upsert({
    where: { membershipId: membership.id },
    update: { name, title, status: 'active' },
    create: {
      id: `seed-teacher-profile-${username}`, membershipId: membership.id,
      name, title, email: `${username}@example.com`, phone: `1390000000${index - 1}`, status: 'active',
    },
  })
  return membership
}

async function upsertStudent(
  username: string,
  name: string,
  index: number,
  passwordHash: string,
  headTeacherMembershipId: string,
) {
  await upsertUser(username, 'student', passwordHash, {
    phone: `138${String(index).padStart(8, '0')}`,
    email: `${username}@example.com`,
  })
  const membership = await upsertMembership(username, 'student')
  const profile = await prisma.organizationStudentProfile.upsert({
    where: { membershipId: membership.id },
    update: { name, headTeacherMembershipId, status: 'active' },
    create: {
      id: `seed-student-profile-${username}`, membershipId: membership.id, name,
      gender: index % 3 === 0 ? '女' : '男', enrollmentYear: 2025 - (index % 6),
      targetContest: 'NOIP', rating: 1180 + (index * 17) % 80,
      headTeacherMembershipId, status: 'active',
    },
  })
  return { userId: userId(username), membership, profile, username, name }
}

async function upsertTeamMember(teamId: string, memberUserId: string, userType: string, role: string, status = 'active', invitedBy?: string) {
  return prisma.teamMember.upsert({
    where: { teamId_userId_userType: { teamId, userId: memberUserId, userType } },
    update: { role, status },
    create: {
      id: `seed-team-member-${teamId}-${memberUserId}`, teamId, userId: memberUserId,
      userType, role, status, joinedAt: status === 'active' ? new Date() : undefined, invitedBy,
    },
  })
}

async function main() {
  console.log('Seeding current organization model...')
  const passwordHash = await bcrypt.hash(PASSWORD, 10)

  await prisma.organization.upsert({
    where: { id: ORGANIZATION_ID },
    update: { name: '第一中学', type: 'school', status: 'active' },
    create: { id: ORGANIZATION_ID, name: '第一中学', type: 'school', status: 'active' },
  })
  await prisma.school.upsert({
    where: { id: SCHOOL_ID },
    update: { name: '第一中学', organizationId: ORGANIZATION_ID, status: 'active', directoryStatus: 'verified' },
    create: {
      id: SCHOOL_ID, name: '第一中学', organizationId: ORGANIZATION_ID, status: 'active', directoryStatus: 'verified',
      announcement: '# 欢迎来到第一中学\n\n这是一所信息学竞赛重点学校。',
    },
  })

  await upsertUser('admin', 'super_admin', passwordHash, { phone: '13800000000', email: 'admin@example.com' })
  await upsertUser('platform_admin', 'platform_admin', passwordHash, { phone: '13800000001', email: 'platform_admin@example.com' })

  const principal = await upsertTeacher('teacher1', '张老师', '主教练', passwordHash, 'school_principal')
  const teacher2 = await upsertTeacher('teacher2', '李老师', '副教练', passwordHash)
  const teacher3 = await upsertTeacher('teacher3', '王老师', '教练', passwordHash)
  await prisma.school.update({ where: { id: SCHOOL_ID }, data: { currentPrincipalMembershipId: principal.id } })

  const teams = await Promise.all([
    prisma.team.upsert({
      where: { id: 'team-advanced' }, update: { organizationId: ORGANIZATION_ID, scope: 'campus' },
      create: { id: 'team-advanced', name: '提高班', description: '信息学竞赛提高班', organizationId: ORGANIZATION_ID, scope: 'campus', isPublic: true },
    }),
    prisma.team.upsert({
      where: { id: 'team-basic' }, update: { organizationId: ORGANIZATION_ID, scope: 'campus' },
      create: { id: 'team-basic', name: '基础班', description: '信息学竞赛基础班', organizationId: ORGANIZATION_ID, scope: 'campus', isPublic: true },
    }),
    prisma.team.upsert({
      where: { id: 'team-contest' }, update: { organizationId: ORGANIZATION_ID, scope: 'campus' },
      create: { id: 'team-contest', name: '竞赛队', description: '信息学竞赛主力队', organizationId: ORGANIZATION_ID, scope: 'campus', isPublic: false },
    }),
  ])

  await upsertTeamMember(teams[0].id, userId('teacher1'), 'teacher', 'owner')
  await upsertTeamMember(teams[1].id, userId('teacher2'), 'teacher', 'owner')
  await upsertTeamMember(teams[2].id, userId('teacher1'), 'teacher', 'owner')
  await upsertTeamMember(teams[2].id, userId('teacher3'), 'teacher', 'admin', 'active', userId('teacher1'))

  const students = []
  const teachers = [principal, teacher2, teacher3]
  for (let index = 1; index <= 25; index++) {
    const student = await upsertStudent(`student${index}`, `学生${String(index).padStart(2, '0')}`, index, passwordHash, teachers[index % teachers.length].id)
    students.push(student)
    if (index <= 8) await upsertTeamMember(teams[0].id, student.userId, 'student', 'member', 'active', userId('teacher1'))
    else if (index <= 16) await upsertTeamMember(teams[1].id, student.userId, 'student', 'member', 'active', userId('teacher2'))
    else if (index <= 20) await upsertTeamMember(teams[0].id, student.userId, 'student', 'member', 'pending', userId('teacher1'))
    else {
      await prisma.teamJoinRequest.upsert({
        where: { teamId_userId: { teamId: teams[1].id, userId: student.userId } },
        update: { status: 'pending' },
        create: { id: `seed-join-${teams[1].id}-${student.userId}`, teamId: teams[1].id, userId: student.userId, status: 'pending', message: '我想加入基础班学习' },
      })
    }
  }
  for (const student of students.slice(0, 3)) {
    await upsertTeamMember(teams[2].id, student.userId, 'student', 'member', 'active', userId('teacher1'))
  }

  await upsertStudent('student', '测试同学', 100, passwordHash, principal.id)
  await upsertStudent('personal_student1', '个人模式同学', 101, passwordHash, principal.id)

  for (const [contestIndex, item] of contestData.entries()) {
    const contest = await prisma.contest.upsert({
      where: { id: item.id }, update: {},
      create: {
        id: item.id, title: item.title, description: item.title, contestDate: new Date(item.date),
        status: 'finished', type: item.type, countRating: item.countRating, scope: 'public', teamId: teams[0].id,
      },
    })
    const ranked = [...students].sort((a, b) => b.profile.rating - a.profile.rating)
    for (const [rankIndex, student] of ranked.entries()) {
      const rank = rankIndex + 1
      const ratingBefore = student.profile.rating + contestIndex * 5
      const ratingChange = Math.max(-10, 20 - rank)
      await prisma.contestResult.upsert({
        where: { contestId_studentProfileId: { contestId: contest.id, studentProfileId: student.profile.id } },
        update: {},
        create: {
          id: `seed-result-${contest.id}-${student.profile.id}`, contestId: contest.id,
          studentProfileId: student.profile.id, studentNameSnapshot: student.name,
          usernameSnapshot: student.username, rank, score: Math.max(0, 105 - rank * 4),
          ratingBefore, ratingAfter: ratingBefore + ratingChange, ratingChange,
        },
      })
    }
  }

  for (const student of students.slice(0, 5)) {
    await prisma.milestone.upsert({
      where: { id: `milestone-${student.membership.id}` }, update: {},
      create: {
        id: `milestone-${student.membership.id}`, studentMembershipId: student.membership.id,
        teacherMembershipId: principal.id, studentNameSnapshot: student.name, teacherNameSnapshot: '张老师',
        title: '入班', description: '正式加入信息学竞赛提高班', milestoneDate: new Date('2024-01-01'), type: 'entry',
      },
    })
  }

  const users = await prisma.user.findMany({ select: { id: true } })
  for (const user of users) {
    await prisma.personalProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } })
  }

  console.log(`Seeding completed: users=${users.length}, students=${students.length + 2}, contests=${contestData.length}`)
}

main()
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => prisma.$disconnect())
