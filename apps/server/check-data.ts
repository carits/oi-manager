import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== 查询 teacher4 用户 ===')
  const teacher4 = await prisma.user.findUnique({
    where: { username: 'teacher4' },
    include: { teacher: true }
  })
  console.log(JSON.stringify(teacher4, null, 2))

  console.log('\n=== 查询所有 school_principal 角色 ===')
  const principals = await prisma.user.findMany({
    where: { role: 'school_principal' },
    include: { teacher: true }
  })
  console.log(JSON.stringify(principals, null, 2))

  console.log('\n=== 查询学校信息 ===')
  const school = await prisma.school.findFirst()
  console.log(JSON.stringify(school, null, 2))

  if (school?.currentPrincipalTeacherId) {
    const principalTeacher = await prisma.teacher.findUnique({
      where: { id: school.currentPrincipalTeacherId },
      include: { user: true }
    })
    console.log('\n=== 当前负责人教师信息 ===')
    console.log(JSON.stringify(principalTeacher, null, 2))
  }

  await prisma.$disconnect()
}

main()
