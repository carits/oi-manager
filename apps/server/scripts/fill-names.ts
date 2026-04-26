/**
 * ⚠️ 已废弃 — 此脚本直接操作数据库，违反项目规范
 * 所有数据操作必须通过 API 进行，禁止脚本直接读写数据库
 * 如需类似功能，请创建对应的 API 端点
 * 详见 CLAUDE.md "禁止直接操作数据库" 规则
 */

/**
 * 填充姓名数据脚本
 * 为没有姓名的用户填充默认姓名（使用用户名）
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('开始填充姓名数据...')

  // 获取平台学校 ID
  const platformSchoolId = 'platform-school-00000000'

  // 1. 处理 Teacher 表
  const teachersWithoutName = await prisma.$queryRaw<{ id: string; userId: string }[]>`
    SELECT t.id, t.userId FROM Teacher t
    INNER JOIN User u ON t.userId = u.id
    WHERE t.name IS NULL OR t.name = ''
  `
  console.log(`教师无姓名数量: ${teachersWithoutName.length}`)

  for (const teacher of teachersWithoutName) {
    const user = await prisma.user.findUnique({ where: { id: teacher.userId } })
    if (user) {
      // 使用用户名作为默认姓名
      const defaultName = user.username.replace(/^t_/, '').replace(/^principal_/, '')
      await prisma.teacher.update({
        where: { id: teacher.id },
        data: { name: defaultName || user.username }
      })
    }
  }
  console.log('教师姓名填充完成')

  // 2. 处理 Student 表
  const studentsWithoutName = await prisma.$queryRaw<{ id: string; userId: string }[]>`
    SELECT s.id, s.userId FROM Student s
    INNER JOIN User u ON s.userId = u.id
    WHERE s.name IS NULL OR s.name = ''
  `
  console.log(`学生无姓名数量: ${studentsWithoutName.length}`)

  for (const student of studentsWithoutName) {
    const user = await prisma.user.findUnique({ where: { id: student.userId } })
    if (user) {
      // 使用用户名作为默认姓名
      const defaultName = user.username.replace(/^stu_/, '').replace(/^student/, '')
      await prisma.student.update({
        where: { id: student.id },
        data: { name: defaultName || user.username }
      })
    }
  }
  console.log('学生姓名填充完成')

  // 3. 处理 Admin 表
  const adminsWithoutName = await prisma.$queryRaw<{ id: string; userId: string }[]>`
    SELECT a.id, a.userId FROM Admin a
    INNER JOIN User u ON a.userId = u.id
    WHERE a.name IS NULL OR a.name = ''
  `
  console.log(`管理员无姓名数量: ${adminsWithoutName.length}`)

  for (const admin of adminsWithoutName) {
    const user = await prisma.user.findUnique({ where: { id: admin.userId } })
    if (user) {
      // 使用用户名作为默认姓名
      const defaultName = user.username.replace(/^admin_/, '').replace(/^platform_/, '')
      await prisma.admin.update({
        where: { id: admin.id },
        data: { name: defaultName || user.username }
      })
    }
  }
  console.log('管理员姓名填充完成')

  // 验证结果
  const teachersEmpty = await prisma.$queryRaw<[{ count: number }]>`
    SELECT COUNT(*) as count FROM Teacher WHERE name IS NULL OR name = ''
  `
  const studentsEmpty = await prisma.$queryRaw<[{ count: number }]>`
    SELECT COUNT(*) as count FROM Student WHERE name IS NULL OR name = ''
  `
  const adminsEmpty = await prisma.$queryRaw<[{ count: number }]>`
    SELECT COUNT(*) as count FROM Admin WHERE name IS NULL OR name = ''
  `

  console.log(`验证结果 - 教师: ${teachersEmpty[0].count}, 学生: ${studentsEmpty[0].count}, 管理员: ${adminsEmpty[0].count}`)
  console.log('姓名数据填充完成!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
