const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function main() {
  console.log('Creating schools and teams...')

  // 1. Create schools
  const school1 = await prisma.school.upsert({
    where: { id: 'school-1' },
    update: {},
    create: {
      id: 'school-1',
      name: '第一中学',
      shortName: '一中',
      code: 'YZ1',
      description: '本地重点中学'
    }
  })

  const school2 = await prisma.school.upsert({
    where: { id: 'school-2' },
    update: {},
    create: {
      id: 'school-2',
      name: '第二中学',
      shortName: '二中',
      code: 'YZ2',
      description: '本地重点中学'
    }
  })

  const school3 = await prisma.school.upsert({
    where: { id: 'school-3' },
    update: {},
    create: {
      id: 'school-3',
      name: '第三中学',
      shortName: '三中',
      code: 'YZ3',
      description: '本地重点中学'
    }
  })

  console.log('Created schools:', school1.name, school2.name, school3.name)

  // 2. Get a teacher to be the leader
  const teacher = await prisma.teacher.findFirst()
  if (!teacher) {
    console.error('No teacher found!')
    process.exit(1)
  }

  // 2. Create teams under schools
  const team1 = await prisma.team.upsert({
    where: { id: 'team-1' },
    update: {},
    create: {
      id: 'team-1',
      name: '信息学竞赛队',
      description: '第一中学信息学竞赛代表队',
      schoolId: school1.id,
      leaderId: teacher.id
    }
  })

  const team2 = await prisma.team.upsert({
    where: { id: 'team-2' },
    update: {},
    create: {
      id: 'team-2',
      name: '信息学竞赛队',
      description: '第二中学信息学竞赛代表队',
      schoolId: school2.id,
      leaderId: teacher.id
    }
  })

  const team3 = await prisma.team.upsert({
    where: { id: 'team-3' },
    update: {},
    create: {
      id: 'team-3',
      name: '信息学竞赛队',
      description: '第三中学信息学竞赛代表队',
      schoolId: school3.id,
      leaderId: teacher.id
    }
  })

  console.log('Created teams:', team1.name, team2.name, team3.name)

  // 3. Bind students to schools and teams
  // Get all students and update their schoolId and teamId
  const students = await prisma.student.findMany()

  for (let i = 0; i < students.length; i++) {
    const student = students[i]
    // Distribute students to different schools/teams based on their school field
    let schoolId = school1.id
    let teamId = team1.id

    if (student.school && student.school.includes('第二')) {
      schoolId = school2.id
      teamId = team2.id
    } else if (student.school && student.school.includes('第三')) {
      schoolId = school3.id
      teamId = team3.id
    } else if (student.school && student.school.includes('第四')) {
      schoolId = school2.id
      teamId = team2.id
    } else if (student.school && student.school.includes('第五')) {
      schoolId = school3.id
      teamId = team3.id
    }

    await prisma.student.update({
      where: { id: student.id },
      data: {
        schoolId: schoolId,
        teamId: teamId
      }
    })
  }
  console.log(`Updated ${students.length} students with school and team`)

  // 4. Bind teachers to schools
  const teachers = await prisma.teacher.findMany()
  for (let i = 0; i < teachers.length; i++) {
    const teacher = teachers[i]
    // Assign teachers to schools
    let schoolId = school1.id
    if (i === 1) schoolId = school2.id
    if (i > 1) schoolId = school3.id

    await prisma.teacher.update({
      where: { id: teacher.id },
      data: { schoolId: schoolId }
    })
  }
  console.log(`Updated ${teachers.length} teachers with school`)

  // 5. Bind contests to teams
  const contests = await prisma.contest.findMany()
  for (const contest of contests) {
    // Assign contests to the first team
    await prisma.contest.update({
      where: { id: contest.id },
      data: { teamId: team1.id }
    })
  }
  console.log(`Updated ${contests.length} contests with team`)

  console.log('Done! Schools and teams created and data bound.')
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect())
