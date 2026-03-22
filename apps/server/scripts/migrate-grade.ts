import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * 将旧的 grade 字段迁移到 enrollmentYear
 * 假设：grade 9 = 初一, 10 = 初二, 11 = 初三, 12 = 高一, 13 = 高二, 14 = 高三
 */
async function migrateGradeToEnrollmentYear() {
  console.log('开始迁移 grade 到 enrollmentYear...')

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const schoolYear = currentMonth >= 9 ? currentYear : currentYear - 1

  const students = await prisma.student.findMany({
    where: {
      grade: { not: null },
      enrollmentYear: null
    }
  })

  console.log(`找到 ${students.length} 个需要迁移的学生`)

  for (const student of students) {
    if (!student.grade) continue

    // 根据当前年级反推入学年份
    // grade 9 = 初一 (yearsFromEnrollment = 0)
    // grade 10 = 初二 (yearsFromEnrollment = 1)
    // grade 11 = 初三 (yearsFromEnrollment = 2)
    // grade 12 = 高一 (yearsFromEnrollment = 3)
    // ...
    const yearsFromEnrollment = student.grade - 9
    const enrollmentYear = schoolYear - yearsFromEnrollment

    await prisma.student.update({
      where: { id: student.id },
      data: { enrollmentYear }
    })

    console.log(`迁移学生 ${student.name}: grade ${student.grade} -> enrollmentYear ${enrollmentYear}`)
  }

  console.log('迁移完成！')
}

migrateGradeToEnrollmentYear()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
