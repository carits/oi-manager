const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // 找到雅礼中学
  const school = await prisma.school.findFirst({
    where: { name: { contains: '雅礼' } }
  })

  if (!school) {
    console.log('找不到雅礼中学')
    await prisma.$disconnect()
    return
  }

  console.log('雅礼中学ID:', school.id)

  // 更新stu_yali_39和stu_yali_40的schoolId
  const result1 = await prisma.student.updateMany({
    where: {
      user: {
        username: 'stu_yali_39'
      }
    },
    data: {
      schoolId: school.id
    }
  })

  const result2 = await prisma.student.updateMany({
    where: {
      user: {
        username: 'stu_yali_40'
      }
    },
    data: {
      schoolId: school.id
    }
  })

  console.log('更新stu_yali_39:', result1.count, '条')
  console.log('更新stu_yali_40:', result2.count, '条')

  // 验证更新结果
  const students = await prisma.student.findMany({
    where: {
      user: {
        username: {
          in: ['stu_yali_39', 'stu_yali_40']
        }
      }
    },
    include: {
      user: {
        select: {
          username: true
        }
      },
      school: {
        select: {
          name: true
        }
      }
    }
  })

  console.log('\n更新后的学生信息:')
  students.forEach(s => {
    console.log(`- ${s.user?.username}: ${s.name}, 学校: ${s.school?.name}, 入学年份: ${s.enrollmentYear}`)
  })

  await prisma.$disconnect()
}

main()
