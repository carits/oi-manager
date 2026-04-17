/**
 * 学校绑定迁移脚本 (SQLite 版本)
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const PLATFORM_SCHOOL_ID = 'platform-school-00000000'

async function main() {
  console.log('开始迁移 (SQLite)...')

  // Step 1: 添加 nullable schoolId 字段
  console.log('\n=== Step 1: 添加 nullable schoolId 字段 ===')

  const userColumns = await prisma.$queryRaw<{ name: string }[]>`PRAGMA table_info(User)`
  const hasUserSchoolId = userColumns.some(col => col.name === 'schoolId')

  if (!hasUserSchoolId) {
    console.log('User 表添加 schoolId 字段...')
    await prisma.$executeRaw`ALTER TABLE User ADD COLUMN schoolId TEXT`
    console.log('User 表 schoolId 字段已添加')
  } else {
    console.log('User 表已有 schoolId 字段')
  }

  const adminColumns = await prisma.$queryRaw<{ name: string }[]>`PRAGMA table_info(Admin)`
  const hasAdminSchoolId = adminColumns.some(col => col.name === 'schoolId')

  if (!hasAdminSchoolId) {
    console.log('Admin 表添加 schoolId 字段...')
    await prisma.$executeRaw`ALTER TABLE Admin ADD COLUMN schoolId TEXT`
    console.log('Admin 表 schoolId 字段已添加')
  } else {
    console.log('Admin 表已有 schoolId 字段')
  }

  // Step 2: 创建平台学校
  console.log('\n=== Step 2: 创建平台学校 ===')

  // 获取第一个教师作为负责人
  const firstTeacher = await prisma.teacher.findFirst()
  const principalId = firstTeacher?.id || 'no-principal-placeholder'

  // 使用 Prisma 的 create 而不是 raw SQL
  try {
    const existingSchool = await prisma.school.findUnique({ where: { id: PLATFORM_SCHOOL_ID } })
    if (!existingSchool) {
      await prisma.school.create({
        data: {
          id: PLATFORM_SCHOOL_ID,
          name: '平台管理',
          region: '系统',
          schoolType: '平台',
          status: 'active',
          currentPrincipalTeacherId: principalId
        }
      })
      console.log(`平台学校已创建: ${PLATFORM_SCHOOL_ID}`)
    } else {
      console.log(`平台学校已存在: ${PLATFORM_SCHOOL_ID}`)
    }
  } catch (e) {
    console.log('创建平台学校出错（可能已存在）:', e)
  }

  // Step 3: 填充数据
  console.log('\n=== Step 3: 填充现有记录的 schoolId ===')

  // 填充 User 表 - 使用 raw SQL 更新
  console.log('更新 User 表...')

  // 系统管理员
  await prisma.$executeRaw`
    UPDATE User SET schoolId = ${PLATFORM_SCHOOL_ID}
    WHERE schoolId IS NULL AND role IN ('super_admin', 'platform_admin')
  `

  // 教师用户（有学校的）- 使用 raw query
  const teachersWithSchool = await prisma.$queryRaw<{ userId: string; schoolId: string }[]>`
    SELECT userId, schoolId FROM Teacher WHERE schoolId IS NOT NULL
  `
  for (const t of teachersWithSchool) {
    if (t.schoolId) {
      await prisma.$executeRaw`
        UPDATE User SET schoolId = ${t.schoolId}
        WHERE id = ${t.userId} AND schoolId IS NULL
      `
    }
  }

  // 教师用户（无学校的）- 绑定到平台学校
  await prisma.$executeRaw`
    UPDATE User SET schoolId = ${PLATFORM_SCHOOL_ID}
    WHERE role = 'teacher' AND schoolId IS NULL
  `

  // 学生用户
  const students = await prisma.student.findMany({ select: { userId: true, schoolId: true } })
  for (const s of students) {
    await prisma.$executeRaw`
      UPDATE User SET schoolId = ${s.schoolId}
      WHERE id = ${s.userId} AND schoolId IS NULL
    `
  }

  // 其他用户
  await prisma.$executeRaw`
    UPDATE User SET schoolId = ${PLATFORM_SCHOOL_ID} WHERE schoolId IS NULL
  `

  console.log('User 表更新完成')

  // 填充 Teacher 表
  console.log('更新 Teacher 表...')
  await prisma.$executeRaw`
    UPDATE Teacher SET schoolId = ${PLATFORM_SCHOOL_ID} WHERE schoolId IS NULL
  `

  // 填充 Admin 表
  console.log('更新 Admin 表...')
  const admins = await prisma.admin.findMany({ select: { userId: true } })
  for (const a of admins) {
    await prisma.$executeRaw`
      UPDATE Admin SET schoolId = ${PLATFORM_SCHOOL_ID}
      WHERE userId = ${a.userId} AND schoolId IS NULL
    `
  }

  // Step 4: 验证
  console.log('\n=== Step 4: 验证数据 ===')

  const usersNull = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM User WHERE schoolId IS NULL
  `
  console.log(`User 无 schoolId: ${usersNull[0].count}`)

  const teacherNull = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM Teacher WHERE schoolId IS NULL
  `
  console.log(`Teacher 无 schoolId: ${teacherNull[0].count}`)

  const adminNull = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM Admin WHERE schoolId IS NULL
  `
  console.log(`Admin 无 schoolId: ${adminNull[0].count}`)

  // 统计
  console.log('\n=== 统计 ===')
  const totalUsers = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM User
  `
  console.log(`总用户数: ${totalUsers[0].count}`)

  const usersBySchool = await prisma.$queryRaw<{ schoolId: string | null; count: bigint }[]>`
    SELECT schoolId, COUNT(*) as count FROM User GROUP BY schoolId
  `
  for (const row of usersBySchool) {
    const name = row.schoolId === PLATFORM_SCHOOL_ID ? '平台管理' : (row.schoolId || 'NULL')
    console.log(`  ${name}: ${row.count} 用户`)
  }

  console.log('\n迁移完成！')
}

main()
  .catch((e) => {
    console.error('迁移失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })