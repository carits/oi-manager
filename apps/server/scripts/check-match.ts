// 检查提交和题目的 problemId 匹配
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function check() {
  // 检查提交数据
  const subs = await prisma.submission.findMany({
    where: { sourceId: 'training-4' },
    select: { userId: true, problemId: true, result: true, score: true },
    take: 5
  })
  console.log('Training-4 提交数据:')
  subs.forEach(s => console.log(JSON.stringify(s)))

  // 检查训练题目
  const tps = await prisma.trainingProblem.findMany({
    where: { trainingId: 4 },
    select: { id: true, problemId: true, alias: true }
  })
  console.log('\n训练题目:')
  tps.forEach(t => console.log(JSON.stringify(t)))

  // 检查匹配
  const tpIds = tps.map(t => t.problemId)
  const subIds = subs.map(s => s.problemId)
  console.log('\n题目ID匹配检查:')
  console.log('TrainingProblem.problemIds:', tpIds.slice(0, 3))
  console.log('Submission.problemIds:', subIds.slice(0, 3))
  console.log('是否有匹配:', tpIds.some(id => subIds.includes(id)))

  await prisma.$disconnect()
}

check().catch(console.error)