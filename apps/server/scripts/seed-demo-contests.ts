import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const DEMO_IDS = [9801, 9802, 9803, 9804, 9805, 9806, 9807, 9808, 9809]

type ContestSeed = {
  id: number
  format: 'oi' | 'ioi' | 'icpc'
  phase: 'live' | 'finished' | 'upcoming'
  title: string
  startOffsetHours: number
  endOffsetHours: number
}

const contests: ContestSeed[] = [
  { id: 9801, format: 'oi', phase: 'live', title: '[演示] OI 模拟赛 - 正在进行', startOffsetHours: -1, endOffsetHours: 5 },
  { id: 9802, format: 'oi', phase: 'finished', title: '[演示] OI 模拟赛 - 已结束', startOffsetHours: -72, endOffsetHours: -48 },
  { id: 9803, format: 'oi', phase: 'upcoming', title: '[演示] OI 模拟赛 - 即将开始', startOffsetHours: 48, endOffsetHours: 54 },
  { id: 9804, format: 'ioi', phase: 'live', title: '[演示] IOI 选拔赛 - 正在进行', startOffsetHours: -2, endOffsetHours: 4 },
  { id: 9805, format: 'ioi', phase: 'finished', title: '[演示] IOI 选拔赛 - 已结束', startOffsetHours: -96, endOffsetHours: -72 },
  { id: 9806, format: 'ioi', phase: 'upcoming', title: '[演示] IOI 选拔赛 - 即将开始', startOffsetHours: 72, endOffsetHours: 78 },
  { id: 9807, format: 'icpc', phase: 'live', title: '[演示] ICPC 校队赛 - 正在进行', startOffsetHours: -3, endOffsetHours: 2 },
  { id: 9808, format: 'icpc', phase: 'finished', title: '[演示] ICPC 校队赛 - 已结束', startOffsetHours: -120, endOffsetHours: -115 },
  { id: 9809, format: 'icpc', phase: 'upcoming', title: '[演示] ICPC 校队赛 - 即将开始', startOffsetHours: 96, endOffsetHours: 101 },
]

function atOffset(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
}

function statusFor(seed: ContestSeed) {
  return seed.phase === 'live' ? 'ongoing' : seed.phase === 'finished' ? 'finished' : 'upcoming'
}

async function main() {
  const studentGroups = await prisma.user.groupBy({
    by: ['schoolId'],
    where: { role: 'student', status: 'active' },
    _count: { _all: true },
    orderBy: { _count: { schoolId: 'desc' } },
  })
  const eligibleSchool = studentGroups.find(group => group._count._all >= 3)
  if (!eligibleSchool) throw new Error('找不到至少有三名学生的学校')
  const teacher = await prisma.user.findFirst({
    where: { schoolId: eligibleSchool.schoolId, role: { in: ['school_principal', 'teacher'] }, status: 'active' },
    orderBy: { username: 'asc' },
    select: { id: true, schoolId: true, username: true },
  })
  if (!teacher) throw new Error('目标学校没有可用于演示比赛的教师账号')

  const students = await prisma.user.findMany({
    where: { schoolId: eligibleSchool.schoolId, role: 'student', status: 'active' },
    orderBy: { username: 'asc' },
    take: 4,
    select: { id: true, username: true },
  })
  if (students.length < 3) throw new Error('演示比赛至少需要 3 名同校学生')

  const existing = await prisma.training.findMany({ where: { id: { in: DEMO_IDS } }, select: { id: true, title: true } })
  const unsafe = existing.find(item => !item.title.startsWith('[演示]'))
  if (unsafe) throw new Error(`演示编号 ${unsafe.id} 已被非演示比赛占用，已停止写入`)

  let problems = await prisma.problem.findMany({
    where: { schoolId: teacher.schoolId, status: { in: ['published', 'draft'] } },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { id: true, problemId: true },
  })
  if (problems.length < 3) {
    const needed = 3 - problems.length
    for (let index = 0; index < needed; index += 1) {
      const problemId = `DEMO-CONTEST-${index + 1}`
      const problem = await prisma.problem.upsert({
        where: { libraryKey_platform_problemId: { libraryKey: teacher.schoolId, platform: 'carits', problemId } },
        create: {
          id: crypto.randomUUID(), platform: 'carits', problemId, title: `演示题目 ${String.fromCharCode(65 + index)}`,
          description: '用于比赛页面展示与评测记录演示的测试题目。', ownerId: teacher.id, ownerType: 'teacher',
          libraryScope: 'school', libraryKey: teacher.schoolId, schoolId: teacher.schoolId, status: 'published', visibility: 'school',
          timeLimit: 1000, memoryLimit: 256,
        },
        update: { status: 'published', updatedAt: new Date() },
        select: { id: true, problemId: true },
      })
      problems.push(problem)
    }
  }

  await prisma.submission.deleteMany({ where: { sourceId: { startsWith: 'demo-contest:' } } })

  for (const seed of contests) {
    const training = await prisma.training.upsert({
      where: { id: seed.id },
      create: {
        id: seed.id, title: seed.title, description: '这是用于查看赛事看板、题目、提交记录和排名效果的演示比赛。',
        format: seed.format, type: 'contest', scope: 'campus', schoolId: teacher.schoolId, createdBy: teacher.id,
        startTime: atOffset(seed.startOffsetHours), endTime: atOffset(seed.endOffsetHours), status: statusFor(seed),
        problemIdVisible: true, solutionVisible: seed.phase === 'finished', includeAdminInRanking: false,
      },
      update: {
        title: seed.title, description: '这是用于查看赛事看板、题目、提交记录和排名效果的演示比赛。',
        format: seed.format, type: 'contest', scope: 'campus', schoolId: teacher.schoolId, createdBy: teacher.id,
        startTime: atOffset(seed.startOffsetHours), endTime: atOffset(seed.endOffsetHours), status: statusFor(seed),
        problemIdVisible: true, solutionVisible: seed.phase === 'finished', includeAdminInRanking: false,
      },
    })

    const trainingProblems = []
    for (const [index, problem] of problems.slice(0, 3).entries()) {
      const row = await prisma.trainingProblem.upsert({
        where: { trainingId_orderIndex: { trainingId: training.id, orderIndex: index } },
        create: { id: `demo-training-${training.id}-problem-${index}`, trainingId: training.id, problemId: problem.id, alias: String.fromCharCode(65 + index), orderIndex: index, points: 100 },
        update: { problemId: problem.id, alias: String.fromCharCode(65 + index), points: 100 },
        select: { id: true, problemId: true },
      })
      trainingProblems.push(row)
    }

    if (seed.phase === 'upcoming') continue
    const start = atOffset(seed.startOffsetHours)
    for (const [studentIndex, student] of students.slice(0, 3).entries()) {
      for (const [problemIndex, trainingProblem] of trainingProblems.entries()) {
        const accepted = seed.format === 'icpc'
          ? (studentIndex + problemIndex) % 3 !== 2
          : (studentIndex * 2 + problemIndex) % 4 !== 3
        const score = accepted ? (seed.format === 'ioi' && problemIndex === 1 && studentIndex === 1 ? 60 : 100) : 0
        const result = accepted ? 'accepted' : 'wrong_answer'
        const createdAt = new Date(start.getTime() + (20 + studentIndex * 24 + problemIndex * 11) * 60 * 1000)
        await prisma.submission.create({
          data: {
            userId: student.id, oj: 'carits', problemId: problems[problemIndex].problemId, language: 'cpp',
            code: `// ${seed.title}\n// ${student.username} submission`, codeLength: 48, result, score,
            timeUsed: 32 + studentIndex * 19 + problemIndex * 7, wallTimeUsed: 35 + studentIndex * 19 + problemIndex * 7,
            memoryUsed: 768 + studentIndex * 256 + problemIndex * 128, metricSource: 'demo', submitMethod: 'demo',
            submitSource: 'contest', submitScope: 'contest', workspaceScope: 'campus', sourceId: `demo-contest:${training.id}`,
            trainingId: training.id, trainingProblemId: trainingProblem.id, contestId: training.id, contestProblemId: trainingProblem.id,
            isGlobalVisible: true, createdAt, updatedAt: createdAt,
          },
        })
        if (seed.format === 'icpc' && accepted && studentIndex === 1) {
          const retryAt = new Date(createdAt.getTime() - 8 * 60 * 1000)
          await prisma.submission.create({
            data: {
              userId: student.id, oj: 'carits', problemId: problems[problemIndex].problemId, language: 'cpp', code: '// 演示错误提交', codeLength: 24,
              result: 'wrong_answer', score: 0, timeUsed: 18, wallTimeUsed: 21, memoryUsed: 704, metricSource: 'demo', submitMethod: 'demo',
              submitSource: 'contest', submitScope: 'contest', workspaceScope: 'campus', sourceId: `demo-contest:${training.id}`,
              trainingId: training.id, trainingProblemId: trainingProblem.id, contestId: training.id, contestProblemId: trainingProblem.id,
              isGlobalVisible: true, createdAt: retryAt, updatedAt: retryAt,
            },
          })
        }
      }
    }
  }

  const verification = await Promise.all(contests.map(async seed => {
    const [problemCount, submissions, participants] = await Promise.all([
      prisma.trainingProblem.count({ where: { trainingId: seed.id } }),
      prisma.submission.count({ where: { trainingId: seed.id, sourceId: `demo-contest:${seed.id}` } }),
      prisma.submission.groupBy({ by: ['userId'], where: { trainingId: seed.id, sourceId: `demo-contest:${seed.id}` } }),
    ])
    return { id: seed.id, format: seed.format, phase: seed.phase, problemCount, submissionCount: submissions, participantCount: participants.length }
  }))
  console.log(JSON.stringify({ schoolId: teacher.schoolId, teacher: teacher.username, students: students.map(student => student.username), contests: verification }, null, 2))
}

main().finally(() => prisma.$disconnect())
