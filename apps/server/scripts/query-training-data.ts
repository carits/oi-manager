// 查询团队成员和训练题目数据
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function query() {
  // 查询团队成员
  const members = await prisma.teamMember.findMany({
    where: { teamId: 'team-contest' },
    orderBy: { role: 'asc' },
    select: {
      userId: true,
      userType: true,
      role: true,
    }
  })

  console.log('团队成员数量:', members.length)
  console.log('\n团队成员详情:')
  for (const m of members) {
    // 获取用户名
    const user = await prisma.user.findUnique({
      where: { id: m.userId },
      select: { username: true }
    })
    console.log(`${m.role} | ${m.userType} | userId: ${m.userId} | username: ${user?.username || 'N/A'}`)
  }

  // 查询训练 ID=4 的题目
  const problems = await prisma.trainingProblem.findMany({
    where: { trainingId: 4 },
    orderBy: { orderIndex: 'asc' },
    select: {
      orderIndex: true,
      alias: true,
      problemId: true,
    }
  })

  console.log('\n训练题目数量:', problems.length)
  console.log('\n训练题目详情:')
  for (const p of problems) {
    console.log(`orderIndex: ${p.orderIndex} | alias: ${p.alias} | problemId: ${p.problemId}`)
  }

  await prisma.$disconnect()
}

query().catch(console.error)