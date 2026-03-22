import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== 所有教师列表 ===')
  const teachers = await prisma.teacher.findMany({
    include: { user: true },
    orderBy: { createdAt: 'asc' }
  })

  const school = await prisma.school.findFirst()

  teachers.forEach(t => {
    const isPrincipal = t.id === school?.currentPrincipalTeacherId
    console.log(`\n教师: ${t.name}`)
    console.log(`  用户名: ${t.user.username}`)
    console.log(`  用户角色: ${t.user.role}`)
    console.log(`  教师ID: ${t.id}`)
    console.log(`  是否负责人: ${isPrincipal ? '是' : '否'}`)
    console.log(`  状态: ${t.status}`)
  })

  await prisma.$disconnect()
}

main()
