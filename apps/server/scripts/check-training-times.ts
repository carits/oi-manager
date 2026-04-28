import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function test() {
  const training = await prisma.training.findUnique({
    where: { id: 4 },
    select: { startTime: true, endTime: true, title: true }
  })
  console.log('Training:', training?.title)
  console.log('StartTime:', training?.startTime?.toISOString())
  console.log('EndTime:', training?.endTime?.toISOString())

  const sub = await prisma.submission.findFirst({
    where: { submitSource: 'training', sourceId: 'training-4' },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true }
  })
  console.log('\nFirst submission createdAt:', sub?.createdAt?.toISOString())

  if (training && sub) {
    const diffMin = (sub.createdAt.getTime() - training.startTime.getTime()) / 60000
    console.log('\nTime diff (minutes):', Math.round(diffMin))
    console.log('Expected: ~10 minutes (from test data generator)')
  }

  await prisma.$disconnect()
}
test()
