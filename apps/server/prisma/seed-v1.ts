import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('开始初始化数据...')

  // 1. 创建示例学校
  const schools = [
    { id: 'school-1', name: '第一中学', description: '市重点高中，信息学竞赛强校' },
    { id: 'school-2', name: '第二中学', description: '普通高中，重视学生全面发展' },
    { id: 'school-3', name: '实验中学', description: '实验中学初中部' }
  ]

  for (const schoolData of schools) {
    await prisma.school.upsert({
      where: { id: schoolData.id },
      update: {},
      create: schoolData
    })
    console.log('创建学校:', schoolData.name)
  }

  // 2. 获取老师
  const teacher = await prisma.teacher.findFirst()
  if (!teacher) {
    console.log('没有找到老师，请先创建老师数据')
    return
  }

  // 3. 创建示例团队
  const teams = [
    { id: 'team-1', name: '竞赛一队', description: '第一中学竞赛队', schoolId: 'school-1' },
    { id: 'team-2', name: '竞赛二队', description: '第一中学提高班', schoolId: 'school-1' },
    { id: 'team-3', name: '第二中学队', description: '第二中学竞赛队', schoolId: 'school-2' },
    { id: 'team-4', name: '初中队', description: '实验中学初中竞赛队', schoolId: 'school-3' }
  ]

  for (const teamData of teams) {
    await prisma.team.upsert({
      where: { id: teamData.id },
      update: {},
      create: {
        id: teamData.id,
        name: teamData.name,
        description: teamData.description,
        schoolId: teamData.schoolId,
        leaderId: teacher.id
      }
    })
    console.log('创建团队:', teamData.name)
  }

  // 4. 给没有正确关联学校的团队设置学校
  const existingTeams = await prisma.team.findMany()
  for (const team of existingTeams) {
    if (!team.schoolId) {
      await prisma.team.update({
        where: { id: team.id },
        data: { schoolId: 'school-1' }
      })
      console.log('修复团队学校:', team.name)
    }
  }

  // 5. 为没有 schoolId 的学生设置学校
  const allStudents = await prisma.student.findMany()
  for (const student of allStudents) {
    let studentSchoolId = 'school-1'
    // 如果学生有团队，从团队获取学校
    if (student.teamId) {
      const team = await prisma.team.findUnique({ where: { id: student.teamId } })
      if (team && team.schoolId) {
        studentSchoolId = team.schoolId
      }
    }
    if (!student.schoolId) {
      await prisma.student.update({
        where: { id: student.id },
        data: { schoolId: studentSchoolId }
      })
      console.log('修复学生 schoolId:', student.name)
    }
  }

  // 6. 迁移比赛数据到团队
  // 规则：除了正赛(official)外，其他比赛(训练赛training、模拟赛mock)都必须绑定团队
  console.log('\n开始迁移比赛数据...')
  const allTeams = await prisma.team.findMany()
  const defaultTeam = allTeams[0]

  const contests = await prisma.contest.findMany()
  for (const contest of contests) {
    // 正赛不需要绑定团队
    if (contest.type === 'official') {
      console.log(`跳过正赛: ${contest.title} (不需要绑定团队)`)
      continue
    }

    // 非正赛（训练赛、模拟赛）必须绑定团队
    if (!contest.teamId) {
      await prisma.contest.update({
        where: { id: contest.id },
        data: { teamId: defaultTeam.id }
      })
      console.log(`迁移比赛: ${contest.title} (${contest.type}) -> 团队: ${defaultTeam.name}`)
    }
  }

  console.log('\n数据初始化完成!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
