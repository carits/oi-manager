/**
 * 修复脚本：将测试用户重新绑定到正确的学校
 *
 * 规则：
 * 1. 学校名称格式: 测试学校_xxx 或 权限测试学校
 * 2. 对应负责人用户名: t_xxx 或 principal_xxx
 * 3. User.schoolId 和 Teacher.schoolId 应该同步更新
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('开始修复学校绑定...')

  // 1. 获取所有学校（排除平台学校）
  const schools = await prisma.school.findMany({
    where: { id: { not: 'platform-school-00000000' } },
    select: { id: true, name: true, currentPrincipalTeacherId: true }
  })
  console.log(`学校总数: ${schools.length}`)

  let fixedCount = 0

  for (const school of schools) {
    // 从学校名称提取标识符
    // 测试学校_1776235345712 -> 1776235345712
    // 权限测试学校 -> 权限测试学校
    const match = school.name.match(/测试学校_(.+)$/)
    const identifier = match ? match[1] : school.name

    // 查找对应的负责人教师
    // 尝试多种用户名格式
    const possibleUsernames = [
      `t_${identifier}`,
      `principal_${identifier}`,
      identifier
    ]

    for (const username of possibleUsernames) {
      const user = await prisma.user.findUnique({
        where: { username },
        include: { Teacher: true }
      })

      if (user && user.Teacher && user.schoolId === 'platform-school-00000000') {
        // 更新 User.schoolId
        await prisma.user.update({
          where: { id: user.id },
          data: { schoolId: school.id }
        })

        // 更新 Teacher.schoolId
        await prisma.teacher.update({
          where: { id: user.Teacher.id },
          data: { schoolId: school.id }
        })

        // 更新学校的负责人
        if (!school.currentPrincipalTeacherId) {
          await prisma.school.update({
            where: { id: school.id },
            data: { currentPrincipalTeacherId: user.Teacher.id }
          })
        }

        console.log(`修复: ${username} -> ${school.name}`)
        fixedCount++
        break
      }
    }
  }

  console.log(`\n修复完成: ${fixedCount} 个用户`)

  // 2. 处理剩余绑定到平台学校的教师和学生
  // 这些可能是测试团队的成员，没有明确的学校归属
  const remainingTeachers = await prisma.user.count({
    where: {
      schoolId: 'platform-school-00000000',
      role: { in: ['teacher', 'school_principal'] }
    }
  })
  const remainingStudents = await prisma.user.count({
    where: {
      schoolId: 'platform-school-00000000',
      role: 'student'
    }
  })

  console.log(`\n剩余绑定到平台学校的用户:`)
  console.log(`  教师/负责人: ${remainingTeachers}`)
  console.log(`  学生: ${remainingStudents}`)

  // 3. 验证结果
  const teachersOnOther = await prisma.teacher.count({
    where: { schoolId: { not: 'platform-school-00000000' } }
  })
  const studentsOnOther = await prisma.student.count({
    where: { schoolId: { not: 'platform-school-00000000' } }
  })

  console.log(`\n验证结果:`)
  console.log(`  Teacher 绑定到真实学校: ${teachersOnOther}`)
  console.log(`  Student 绑定到真实学校: ${studentsOnOther}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })