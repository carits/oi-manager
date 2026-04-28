// 检查用户是否存在
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const USER_IDS = [
  '8b5aa27f-b023-4920-822b-d6f6567ea798',
  'd6a48297-ce9b-4763-8e28-b2518aa11b94',
  'fa89dc03-516b-481f-b75b-11ce9538c7af',
  '7aa8d382-a7ce-4e78-a976-cfb4a754db1f',
  'c5190299-9506-4873-abcf-7575d81168a0',
  'd3ebf39c-03b8-4960-9ac8-e24f5674471e',
]

async function check() {
  for (const userId of USER_IDS) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, role: true, status: true }
    })
    if (user) {
      console.log(`✅ 用户存在: ${userId} | username: ${user.username} | role: ${user.role}`)
    } else {
      console.log(`❌ 用户不存在: ${userId}`)
    }
  }

  // 查询所有用户数量
  const count = await prisma.user.count()
  console.log(`\n总用户数: ${count}`)

  await prisma.$disconnect()
}

check().catch(console.error)