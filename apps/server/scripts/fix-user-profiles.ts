/**
 * ⚠️ 已废弃 — 此脚本直接操作数据库，违反项目规范
 * 所有数据操作必须通过 API 进行，禁止脚本直接读写数据库
 * 如需类似功能，请创建对应的 API 端点
 * 详见 CLAUDE.md "禁止直接操作数据库" 规则
 */

/**
 * 修复脚本：为现有用户创建缺失的 Teacher/Student/Admin 记录
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('开始修复用户关联记录...')

  // 获取所有用户
  const users = await prisma.user.findMany({
    select: { id: true, username: true, role: true, schoolId: true }
  })
  console.log(`总用户数: ${users.length}`)

  // 1. 为教师角色创建 Teacher 记录
  const teacherRoles = ['teacher', 'school_principal']
  const teachersToCreate = users.filter(u =>
    teacherRoles.includes(u.role)
  )
  console.log(`教师角色用户数: ${teachersToCreate.length}`)

  for (const user of teachersToCreate) {
    const existingTeacher = await prisma.teacher.findUnique({ where: { id: user.id } })
    if (!existingTeacher) {
      // 检查 schoolId 是否有效
      const school = await prisma.school.findUnique({ where: { id: user.schoolId } })
      if (!school) {
        console.log(`用户 ${user.username} 的 schoolId ${user.schoolId} 无效，跳过`)
        continue
      }

      // 使用用户名作为默认姓名（去除前缀）
      const defaultName = user.username
        .replace(/^t_/, '')
        .replace(/^principal_/, '')
        .replace(/^teacher/, '')
        .replace(/^\d+$/, user.username) // 如果只剩数字，保留原用户名

      await prisma.teacher.create({
        data: {
          userId: user.id,
          name: defaultName || user.username,
          schoolId: user.schoolId,
          status: 'active'
        }
      })
      console.log(`创建 Teacher 记录: ${user.username} -> ${defaultName || user.username}`)
    }
  }

  // 2. 为学生角色创建 Student 记录
  const studentsToCreate = users.filter(u => u.role === 'student')
  console.log(`学生角色用户数: ${studentsToCreate.length}`)

  for (const user of studentsToCreate) {
    const existingStudent = await prisma.student.findUnique({ where: { id: user.id } })
    if (!existingStudent) {
      // 检查 schoolId 是否有效
      const school = await prisma.school.findUnique({ where: { id: user.schoolId } })
      if (!school) {
        console.log(`用户 ${user.username} 的 schoolId ${user.schoolId} 无效，跳过`)
        continue
      }

      // 使用用户名作为默认姓名（去除前缀）
      const defaultName = user.username
        .replace(/^stu_/, '')
        .replace(/^student/, '')
        .replace(/^\d+$/, user.username)

      await prisma.student.create({
        data: {
          userId: user.id,
          name: defaultName || user.username,
          schoolId: user.schoolId,
          rating: 1200
        }
      })
      console.log(`创建 Student 记录: ${user.username} -> ${defaultName || user.username}`)
    }
  }

  // 3. 为管理员角色创建 Admin 记录
  const adminRoles = ['super_admin', 'platform_admin']
  const adminsToCreate = users.filter(u => adminRoles.includes(u.role))
  console.log(`管理员角色用户数: ${adminsToCreate.length}`)

  for (const user of adminsToCreate) {
    const existingAdmin = await prisma.admin.findUnique({ where: { id: user.id } })
    if (!existingAdmin) {
      // 检查 schoolId 是否有效
      const school = await prisma.school.findUnique({ where: { id: user.schoolId } })
      if (!school) {
        console.log(`用户 ${user.username} 的 schoolId ${user.schoolId} 无效，跳过`)
        continue
      }

      // 使用用户名作为默认姓名
      const defaultName = user.username
        .replace(/^admin_/, '')
        .replace(/^platform_/, '')
        .replace(/^super_/, '')

      await prisma.admin.create({
        data: {
          userId: user.id,
          name: defaultName || user.username,
          schoolId: user.schoolId
        }
      })
      console.log(`创建 Admin 记录: ${user.username} -> ${defaultName || user.username}`)
    }
  }

  // 验证结果
  const teacherCount = await prisma.teacher.count()
  const studentCount = await prisma.student.count()
  const adminCount = await prisma.admin.count()

  console.log(`\n验证结果:`)
  console.log(`Teacher 记录数: ${teacherCount}`)
  console.log(`Student 记录数: ${studentCount}`)
  console.log(`Admin 记录数: ${adminCount}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
