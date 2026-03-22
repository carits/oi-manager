import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== Schools ===')
  const schools = await prisma.school.findMany()
  console.log(JSON.stringify(schools, null, 2))

  console.log('\n=== Teams ===')
  const teams = await prisma.team.findMany({ include: { school: true } })
  console.log(JSON.stringify(teams.map(t => ({ name: t.name, school: t.school?.name })), null, 2))

  console.log('\n=== Contests ===')
  const contests = await prisma.contest.findMany({ select: { id: true, title: true, type: true, teamId: true } })
  console.log(JSON.stringify(contests, null, 2))
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
