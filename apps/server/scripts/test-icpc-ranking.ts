import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'

const prisma = new PrismaClient()

async function test() {
  // 获取训练 4 的团队 ID
  const training = await prisma.training.findUnique({
    where: { id: 4 },
    select: { teamId: true }
  })

  if (!training) { console.log('Training not found'); return }

  // 获取学生成员
  const members = await prisma.teamMember.findMany({
    where: { teamId: training.teamId, status: 'active' },
    select: { id: true, userType: true, role: true }
  })

  console.log('Team members:', members.length)
  console.log('Owners/admins:', members.filter(m => m.role === 'owner' || m.role === 'admin').map(m => ({ userId: m.userId.slice(0, 8), userType: m.userType, role: m.role })))

  const studentMember = members.find(m => m.userType === 'student' && m.role === 'member')
  if (!studentMember) { console.log('No student member found'); return }

  const student = await prisma.student.findUnique({
    where: { id: studentMember.userId },
    select: { id: true, name: true }
  })

  if (!student) { console.log('Student not found'); return }

  console.log('\nTesting with student:', student.name, 'User.id:', student.userId)

  const token = jwt.sign(
    { userId: student.userId, role: 'student', studentId: studentMember.userId },
    process.env.JWT_SECRET || 'dev-secret-key-12345',
    { expiresIn: '7d' }
  )

  const res = await fetch('http://localhost:3002/api/contests/4/ranking', {
    headers: { Authorization: 'Bearer ' + token }
  })

  const data = await res.json()
  console.log('\nAPI Response status:', res.status)
  console.log('Success:', data.success)

  if (data.success) {
    console.log('\nRanking format:', data.data.format)
    console.log('Problems:', data.data.problems.length)
    console.log('\nRanking:')
    data.data.ranking.forEach((r: any, i: number) => {
      console.log(`  ${i+1}. ${r.name.padEnd(12)} solved=${r.solvedCount} penalty=${r.totalPenalty}`)
    })
    console.log('\nTotal ranked:', data.data.ranking.length)
  } else {
    console.log('Error:', data.message)
  }

  await prisma.$disconnect()
}

test().catch(console.error)
