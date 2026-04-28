// 检查 userId 是否是 Teacher/Student ID
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const STUDENT_IDS = [
  '8b5aa27f-b023-4920-822b-d6f6567ea798',
  'd6a48297-ce9b-4763-8e28-b2518aa11b94',
  'fa89dc03-516b-481f-b75b-11ce9538c7af',
  '7aa8d382-a7ce-4e78-a976-cfb4a754db1f',
  '8153e253-762e-406f-9557-98a4d3ad9129',
  'f6835f24-f301-4354-9517-dd12e707a404',
  'a263d862-653f-49f1-bc78-36e6570acf54',
  'd72eb9a8-4849-45fc-902b-1e443baf83b2',
  '7514ff86-2dc0-4d0e-996d-c582f70d987a',
  'c70e6af7-7b11-4724-a364-c7205fa9086b',
  '19a62a6f-c648-48b6-9cc3-870458722b4c',
]

const TEACHER_IDS = [
  'c5190299-9506-4873-abcf-7575d81168a0',  // admin
  'd3ebf39c-03b8-4960-9ac8-e24f5674471e',  // owner
]

async function check() {
  console.log('检查 Student 表:')
  for (const id of STUDENT_IDS) {
    const student = await prisma.student.findUnique({
      where: { id },
      select: { id: true, name: true, userId: true }
    })
    if (student) {
      const user = await prisma.user.findUnique({
        where: { id: student.userId },
        select: { username: true }
      })
      console.log(`✅ Student: ${id} | name: ${student.name} | userId (User表): ${student.userId} | username: ${user?.username || 'N/A'}`)
    } else {
      console.log(`❌ Student 不存在: ${id}`)
    }
  }

  console.log('\n检查 Teacher 表:')
  for (const id of TEACHER_IDS) {
    const teacher = await prisma.teacher.findUnique({
      where: { id },
      select: { id: true, name: true, userId: true }
    })
    if (teacher) {
      const user = await prisma.user.findUnique({
        where: { id: teacher.userId },
        select: { username: true }
      })
      console.log(`✅ Teacher: ${id} | name: ${teacher.name} | userId (User表): ${teacher.userId} | username: ${user?.username || 'N/A'}`)
    } else {
      console.log(`❌ Teacher 不存在: ${id}`)
    }
  }

  await prisma.$disconnect()
}

check().catch(console.error)