const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const teacher = await prisma.user.findUnique({
    where: { username: 'teacher' },
    include: { teacher: true }
  });
  console.log('Teacher user:', JSON.stringify(teacher, null, 2));
  
  if (teacher?.teacher?.schoolId) {
    const students = await prisma.student.findMany({
      where: { schoolId: teacher.teacher.schoolId },
      take: 3,
      include: {
        user: { select: { username: true } },
        teams: { include: { team: { select: { name: true } } } }
      }
    });
    console.log('\nStudents:', JSON.stringify(students, null, 2));
  }
  
  await prisma.$disconnect();
}

main();
