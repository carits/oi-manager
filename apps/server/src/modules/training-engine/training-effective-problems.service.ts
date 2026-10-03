import type { Prisma } from '@prisma/client'
import { prisma } from '../../prisma'

type TrainingDb = Prisma.TransactionClient | typeof prisma

const problemInclude = {
  Problem: {
    select: {
      id: true,
      platform: true,
      problemId: true,
      title: true,
      difficulty: true,
      timeLimit: true,
      memoryLimit: true,
    },
  },
} satisfies Prisma.TrainingSessionProblemInclude

export function resolveEffectiveProblemIdsFromSnapshot(
  currentRoundId: string | null,
  groupId: string,
  assignments: Array<{ roundId: string; groupId: string; sessionProblemId: string; active: boolean; orderIndex: number }>,
) {
  if (!currentRoundId) return []
  return assignments
    .filter(item => item.roundId === currentRoundId && item.groupId === groupId && item.active)
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map(item => item.sessionProblemId)
}

export async function resolveEffectiveProblemsForGroup(
  sessionId: string,
  groupId: string,
  client: TrainingDb = prisma,
) {
  const session = await client.trainingSession.findUnique({
    where: { id: sessionId },
    select: { currentRoundId: true },
  })
  if (!session?.currentRoundId) return []
  const assignments = await client.trainingRoundProblemAssignment.findMany({
    where: {
      roundId: session.currentRoundId,
      groupId,
      active: true,
      Round: { sessionId },
    },
    orderBy: { orderIndex: 'asc' },
    include: { SessionProblem: { include: problemInclude } },
  })
  return assignments.map(item => item.SessionProblem)
}

export async function resolveEffectiveSessionProblems(
  sessionId: string,
  participantId: string,
  client: TrainingDb = prisma,
) {
  const participant = await client.trainingSessionParticipant.findFirst({
    where: { id: participantId, sessionId, status: 'active' },
    select: { groupId: true },
  })
  if (!participant) return []
  return resolveEffectiveProblemsForGroup(sessionId, participant.groupId, client)
}

export async function reconcileParticipantCurrentProblem(
  sessionId: string,
  participantId: string,
  client: TrainingDb = prisma,
) {
  const participant = await client.trainingSessionParticipant.findFirst({
    where: { id: participantId, sessionId },
    select: { id: true, currentSessionProblemId: true, returnSessionProblemId: true },
  })
  if (!participant) return null
  const effective = await resolveEffectiveSessionProblems(sessionId, participant.id, client)
  const allowed = new Set(effective.map(problem => problem.id))
  const current = participant.currentSessionProblemId && allowed.has(participant.currentSessionProblemId)
    ? participant.currentSessionProblemId
    : effective[0]?.id || null
  const returning = participant.returnSessionProblemId && allowed.has(participant.returnSessionProblemId)
    ? participant.returnSessionProblemId
    : null
  if (current !== participant.currentSessionProblemId || returning !== participant.returnSessionProblemId) {
    await client.trainingSessionParticipant.update({
      where: { id: participant.id },
      data: {
        currentSessionProblemId: current,
        returnSessionProblemId: returning,
      },
    })
  }
  return current
}
