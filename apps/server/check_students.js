const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const students = await prisma.student.findMany({
    select: { name: true, enrollmentYear: true },
    orderBy: { enrollmentYear: 'desc' }
  })
  
  console.log('所有学生的入学年份：')
  students.forEach(s => {
    console.log(`${s.name}: ${s.enrollmentYear}`)
  })
  
  await prisma.$disconnect()
}

main()
