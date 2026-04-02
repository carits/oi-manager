import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('开始修复学生数据...')

  // 1. 查找没有主教练的学生
  const studentsWithoutHeadTeacher = await prisma.student.findMany({
    where: { headTeacherId: null }
  })
  console.log(`发现 ${studentsWithoutHeadTeacher.length} 个没有主教练的学生`)

  // 2. 查找没有用户名的学生
  const studentsWithoutUser = await prisma.student.findMany({
    where: { userId: null }
  })
  console.log(`发现 ${studentsWithoutUser.length} 个没有用户名的学生`)

  // 3. 为每个学校找一个默认教师作为主教练
  const schools = await prisma.school.findMany({
    include: {
      Teacher: {
        where: { status: 'active' },
        take: 1
      }
    }
  })

  const schoolTeacherMap = new Map<string, string>()
  for (const school of schools) {
    if (school.Teacher.length > 0) {
      schoolTeacherMap.set(school.id, school.Teacher[0].id)
    }
  }

  // 4. 修复没有主教练的学生
  for (const student of studentsWithoutHeadTeacher) {
    const defaultTeacherId = schoolTeacherMap.get(student.schoolId)
    if (defaultTeacherId) {
      await prisma.student.update({
        where: { id: student.id },
        data: { headTeacherId: defaultTeacherId }
      })
      console.log(`为学生 ${student.name} 分配主教练: ${defaultTeacherId}`)
    } else {
      console.log(`警告: 学生 ${student.name} 所在学校没有教师，无法分配主教练`)
    }
  }

  // 5. 修复没有用户名的学生
  const tempPassword = await bcrypt.hash('123456', 10)
  for (const student of studentsWithoutUser) {
    // 生成用户名：学生姓名拼音 + 随机数
    const username = `student_${student.id.substring(0, 8)}`

    // 检查用户名是否已存在
    const existingUser = await prisma.user.findUnique({ where: { username } })
    if (existingUser) {
      // 如果用户名已存在，关联到该学生
      await prisma.student.update({
        where: { id: student.id },
        data: { userId: existingUser.id }
      })
      console.log(`学生 ${student.name} 关联已有用户: ${username}`)
    } else {
      // 创建新用户
      const newUser = await prisma.user.create({
        data: {
          username,
          passwordHash: tempPassword,
          role: 'student'
        }
      })
      await prisma.student.update({
        where: { id: student.id },
        data: { userId: newUser.id }
      })
      console.log(`为学生 ${student.name} 创建用户: ${username}, 密码: 123456`)
    }
  }

  console.log('修复完成!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())