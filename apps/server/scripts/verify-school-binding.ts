import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function check() {
  console.log('=== 验证数据库结构 ===\n')

  // 检查 User 表结构
  const userCols = await prisma.$queryRaw<{ name: string; notnull: number }[]>`PRAGMA table_info(User)`
  const schoolIdCol = userCols.find(c => c.name === 'schoolId')
  console.log('User.schoolId:', schoolIdCol ? (schoolIdCol.notnull === 1 ? 'NOT NULL ✓' : 'nullable ✗') : '不存在 ✗')

  // 检查 Admin 表结构
  const adminCols = await prisma.$queryRaw<{ name: string; notnull: number }[]>`PRAGMA table_info(Admin)`
  const adminSchoolIdCol = adminCols.find(c => c.name === 'schoolId')
  console.log('Admin.schoolId:', adminSchoolIdCol ? (adminSchoolIdCol.notnull === 1 ? 'NOT NULL ✓' : 'nullable ✗') : '不存在 ✗')

  // 检查 Teacher 表结构
  const teacherCols = await prisma.$queryRaw<{ name: string; notnull: number }[]>`PRAGMA table_info(Teacher)`
  const teacherSchoolIdCol = teacherCols.find(c => c.name === 'schoolId')
  console.log('Teacher.schoolId:', teacherSchoolIdCol ? (teacherSchoolIdCol.notnull === 1 ? 'NOT NULL ✓' : 'nullable ✗') : '不存在 ✗')

  // 检查 School 表是否有 User 关系
  const schoolCols = await prisma.$queryRaw<{ name: string }[]>`PRAGMA table_info(School)`
  console.log('\nSchool 表字段:', schoolCols.map(c => c.name).join(', '))

  // 验证数据完整性
  console.log('\n=== 验证数据完整性 ===\n')

  const usersWithoutSchool = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) as count FROM User WHERE schoolId IS NULL`
  console.log('User 无 schoolId:', usersWithoutSchool[0].count === BigInt(0) ? '0 ✓' : `${usersWithoutSchool[0].count} ✗`)

  const teacherWithoutSchool = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) as count FROM Teacher WHERE schoolId IS NULL`
  console.log('Teacher 无 schoolId:', teacherWithoutSchool[0].count === BigInt(0) ? '0 ✓' : `${teacherWithoutSchool[0].count} ✗`)

  const adminWithoutSchool = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) as count FROM Admin WHERE schoolId IS NULL`
  console.log('Admin 无 schoolId:', adminWithoutSchool[0].count === BigInt(0) ? '0 ✓' : `${adminWithoutSchool[0].count} ✗`)

  // 统计
  console.log('\n=== 统计 ===\n')

  const totalUsers = await prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) as count FROM User`
  console.log('总用户数:', totalUsers[0].count)

  const usersBySchool = await prisma.$queryRaw<{ schoolId: string; count: bigint }[]>`
    SELECT schoolId, COUNT(*) as count FROM User GROUP BY schoolId
  `
  for (const row of usersBySchool) {
    const school = await prisma.school.findUnique({ where: { id: row.schoolId } })
    const schoolName = school?.name || row.schoolId
    console.log(`  ${schoolName}: ${row.count} 用户`)
  }

  await prisma.$disconnect()
  console.log('\n验证完成！')
}

check()