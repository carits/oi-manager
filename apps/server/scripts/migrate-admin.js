const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  console.log('开始迁移管理员数据...\n')

  // 1. 找出所有管理员用户（super_admin, platform_admin）
  const adminUsers = await prisma.user.findMany({
    where: { role: { in: ['super_admin', 'platform_admin'] } },
    include: { teacher: true }
  })

  console.log(`找到 ${adminUsers.length} 个管理员用户`)

  for (const user of adminUsers) {
    console.log(`\n处理: ${user.username} (${user.role})`)

    if (!user.teacher) {
      console.log('  - 没有 Teacher 记录，跳过')
      continue
    }

    // 检查是否已有 Admin 记录
    const existingAdmin = await prisma.admin.findUnique({
      where: { userId: user.id }
    })

    if (existingAdmin) {
      console.log('  - 已有 Admin 记录，跳过')
      continue
    }

    // 2. 在 Admin 表创建记录
    await prisma.admin.create({
      data: {
        userId: user.id,
        name: user.teacher.name
      }
    })
    console.log(`  - 创建 Admin 记录: name=${user.teacher.name}`)

    // 3. 删除 Teacher 记录
    await prisma.teacher.delete({ where: { id: user.teacher.id } })
    console.log('  - 删除 Teacher 记录')
  }

  console.log('\n迁移完成!')

  // 验证结果
  const admins = await prisma.admin.findMany({
    include: { user: true }
  })
  console.log('\n当前 Admin 表记录:')
  admins.forEach(a => {
    console.log(`  - ${a.user.username}: ${a.name} (${a.user.role})`)
  })
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
