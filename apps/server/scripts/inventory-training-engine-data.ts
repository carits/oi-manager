import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const [sessions, problems, rounds, assignments, groups, participants, progress, drafts, submissions, statuses, roundStates] = await Promise.all([
    prisma.trainingSession.count(),
    prisma.trainingSessionProblem.count(),
    prisma.trainingSessionRound.count(),
    prisma.trainingRoundProblemAssignment.count(),
    prisma.trainingSessionGroup.count(),
    prisma.trainingSessionParticipant.count(),
    prisma.trainingSessionProblemProgress.count(),
    prisma.trainingSessionProblemDraft.count(),
    prisma.submission.count({ where: { trainingSessionId: { not: null } } }),
    prisma.trainingSession.groupBy({ by: ['status'], _count: { _all: true }, orderBy: { status: 'asc' } }),
    prisma.trainingSessionRound.groupBy({ by: ['lifecycle'], _count: { _all: true }, orderBy: { lifecycle: 'asc' } }),
  ])

  process.stdout.write(JSON.stringify({
    generatedAt: new Date().toISOString(),
    model: 'training-v3',
    totals: { sessions, problems, rounds, assignments, groups, participants, progress, drafts, submissions },
    statuses,
    roundStates,
  }, null, 2) + '\n')
}

main().finally(() => prisma.$disconnect())
