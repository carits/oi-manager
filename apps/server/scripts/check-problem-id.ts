// 检查 TrainingProblem 和 Submission 的 problemId 关联
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function check() {
  // 查看训练题目表结构
  const tp = await prisma.trainingProblem.findFirst({
    where: { trainingId: 4 },
    select: { id: true, problemId: true, alias: true, Problem: { select: { id: true, problemId: true } } }
  })
  console.log('TrainingProblem 结构:')
  console.log(JSON.stringify(tp, null, 2))

  // 查看刚插入的提交
  const sub = await prisma.submission.findFirst({
    where: { sourceId: 'training-4' },
    select: { problemId: true, result: true, createdAt: true }
  })
  console.log('\nSubmission problemId:')
  console.log(JSON.stringify(sub))

  await prisma.$disconnect()
}

check().catch(console.error)