import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface Issue {
  code: string
  sessionId: string
  detail: string
}

async function main() {
  const sessions = await prisma.trainingSession.findMany({
    include: {
      Rounds: { include: { Assignments: true } },
      Groups: { include: { Participants: true } },
      Problems: true,
      Participants: { include: { Progress: true } },
      CurrentRound: true,
    },
  })
  const issues: Issue[] = []

  for (const session of sessions) {
    const roundIds = new Set(session.Rounds.map(round => round.id))
    const groupIds = new Set(session.Groups.map(group => group.id))
    const problemIds = new Set(session.Problems.map(problem => problem.id))

    if (session.currentRoundId && !roundIds.has(session.currentRoundId)) {
      issues.push({ code: 'CURRENT_ROUND_OUTSIDE_SESSION', sessionId: session.id, detail: session.currentRoundId })
    }
    if (session.currentRoundId && session.CurrentRound?.lifecycle !== 'RUNNING') {
      issues.push({ code: 'CURRENT_ROUND_NOT_RUNNING', sessionId: session.id, detail: session.CurrentRound?.lifecycle || 'missing' })
    }
    if (['RUNNING', 'PAUSED'].includes(session.status) && !session.currentRoundId) {
      issues.push({ code: 'ACTIVE_SESSION_WITHOUT_ROUND', sessionId: session.id, detail: session.status })
    }
    for (const round of session.Rounds) {
      for (const assignment of round.Assignments) {
        if (!groupIds.has(assignment.groupId) || !problemIds.has(assignment.sessionProblemId)) {
          issues.push({ code: 'ASSIGNMENT_CROSS_SESSION', sessionId: session.id, detail: assignment.id })
        }
      }
    }
    for (const participant of session.Participants) {
      if (!groupIds.has(participant.groupId)) {
        issues.push({ code: 'PARTICIPANT_GROUP_OUTSIDE_SESSION', sessionId: session.id, detail: participant.id })
      }
      if (participant.currentSessionProblemId && !problemIds.has(participant.currentSessionProblemId)) {
        issues.push({ code: 'PARTICIPANT_PROBLEM_OUTSIDE_SESSION', sessionId: session.id, detail: participant.id })
      }
      for (const progress of participant.Progress) {
        if (!problemIds.has(progress.sessionProblemId)) {
          issues.push({ code: 'PROGRESS_PROBLEM_OUTSIDE_SESSION', sessionId: session.id, detail: progress.id })
        }
      }
    }
  }

  process.stdout.write(JSON.stringify({ checkedAt: new Date().toISOString(), sessions: sessions.length, issues }, null, 2) + '\n')
  if (issues.length) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
