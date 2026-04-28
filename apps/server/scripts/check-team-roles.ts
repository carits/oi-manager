// 检查团队成员角色
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function check() {
  const members = await prisma.teamMember.findMany({
    where: { teamId: 'team-contest' },
    orderBy: { role: 'asc' },
    select: {
      userId: true,
      userType: true,
      role: true,
    }
  })

  console.log('团队成员角色:')
  for (const m of members) {
    // 查询用户名
    let name = '未知'
    if (m.userType === 'teacher') {
      const teacher = await prisma.teacher.findUnique({
        where: { userId: m.userId },
        select: { name: true }
      })
      name = teacher?.name || '未知教师'
    } else if (m.userType === 'student') {
      const student = await prisma.student.findUnique({
        where: { userId: m.userId },
        select: { name: true }
      })
      name = student?.name || '未知学生'
    }
    console.log(`${name.padEnd(8)} - ${m.role}`)
  }

  // 检查 admin 过滤后的排名
  const adminMembers = members.filter(m => m.role === 'owner' || m.role === 'admin')
  console.log('\nAdmin/Owner 成员（不计入排名）:')
  for (const m of adminMembers) {
    let name = '未知'
    if (m.userType === 'teacher') {
      const teacher = await prisma.teacher.findUnique({
        where: { userId: m.userId },
        select: { name: true }
      })
      name = teacher?.name || '未知教师'
    }
    console.log(`${name.padEnd(8)} - ${m.role}`)
  }

  await prisma.$disconnect()
}

check().catch(console.error)