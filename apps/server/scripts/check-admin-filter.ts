// 检查 adminUserIds 和 Submission.userId 的关系
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function check() {
  // 查询 teamMember 的 userId 和 User 表的 userId 关系
  const members = await prisma.teamMember.findMany({
    where: { teamId: 'team-contest', role: { in: ['owner', 'admin'] } },
    select: { id: true, role: true, userType: true }
  })

  console.log('Admin/Owner TeamMember.userId:')
  for (const m of members) {
    console.log('userId:', m.userId, 'role:', m.role, 'userType:', m.userType)

    // 查询对应的 Teacher/Student
    if (m.userType === 'teacher') {
      const teacher = await prisma.teacher.findUnique({
        where: { id: m.userId },  // TeamMember.userId 是 Teacher.id
        select: { id: true, name: true }
      })
      console.log('  Teacher.id:', m.userId, '-> Teacher.userId (User.id):', teacher?.userId)
    }
  }

  // 查询提交的 userId
  const sub = await prisma.submission.findFirst({
    where: { sourceId: 'training-4', result: 'accepted' },
    select: { id: true }
  })
  console.log('\nSubmission.userId:', sub?.userId)

  // 检查是否匹配
  const adminUserIdsFromTeamMember = members.map(m => m.userId)
  console.log('\nadminUserIds (TeamMember.userId = Teacher.id):', adminUserIdsFromTeamMember)
  console.log('Submission.userId 在 adminUserIds 中?', adminUserIdsFromTeamMember.includes(sub?.userId || ''))

  // 正确做法：查询 Teacher.userId (User.id)
  const adminUserIds: string[] = []
  for (const m of members) {
    if (m.userType === 'teacher') {
      const teacher = await prisma.teacher.findUnique({
        where: { id: m.userId },
        select: { id: true }
      })
      if (teacher) adminUserIds.push(teacher.userId)
    }
  }
  console.log('\n正确的 adminUserIds (Teacher.userId = User.id):', adminUserIds)
  console.log('Submission.userId 在正确的 adminUserIds 中?', adminUserIds.includes(sub?.userId || ''))

  await prisma.$disconnect()
}

check().catch(console.error)