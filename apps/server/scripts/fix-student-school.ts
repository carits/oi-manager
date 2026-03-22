// 修复没有学校的学生数据
// 运行: npx tsx scripts/fix-student-school.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // 1. 查找所有没有学校的学生
  const studentsWithoutSchool = await prisma.student.findMany({
    where: { schoolId: null },
    include: { user: { select: { username: true } } }
  })

  console.log(`找到 ${studentsWithoutSchool.length} 个没有学校的学生`)

  if (studentsWithoutSchool.length === 0) {
    console.log('所有学生都已分配学校')
    return
  }

  // 2. 获取第一个学校（或默认学校）
  const schools = await prisma.school.findMany({
    take: 1,
    orderBy: { createdAt: 'asc' }
  })

  if (schools.length === 0) {
    console.error('没有找到任何学校，请先创建学校')
    return
  }

  const defaultSchool = schools[0]
  console.log(`将分配到学校: ${defaultSchool.name} (${defaultSchool.id})`)

  // 3. 更新所有没有学校的学生
  for (const student of studentsWithoutSchool) {
    await prisma.student.update({
      where: { id: student.id },
      data: { schoolId: defaultSchool.id }
    })
    console.log(`✅ 已更新学生: ${student.name} (${student.user?.username || '无用户名'})`)
  }

  console.log('所有学生数据已修复')
}

main()
  .catch((e) => {
    console.error('修复失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
