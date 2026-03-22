import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== 修复陈文俊的角色 ===')

  // 将 teacher4 (陈文俊) 的角色从 school_principal 改回 teacher
  const result = await prisma.user.update({
    where: { username: 'teacher4' },
    data: { role: 'teacher' }
  })

  console.log('已将陈文俊的角色从 school_principal 改为 teacher')
  console.log(JSON.stringify(result, null, 2))

  console.log('\n=== 验证修复结果 ===')
  const principals = await prisma.user.findMany({
    where: { role: 'school_principal' },
    include: { teacher: true }
  })

  console.log(`现在系统中有 ${principals.length} 个 school_principal 角色用户：`)
  principals.forEach(p => {
    console.log(`- ${p.username} (${p.teacher?.name})`)
  })

  const school = await prisma.school.findFirst()
  console.log(`\n学校负责人教师ID: ${school?.currentPrincipalTeacherId}`)

  await prisma.$disconnect()
}

main()
