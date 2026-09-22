import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { ensureCanonicalContestFixtureTx, syncCanonicalContestProblemFixtureTx } from './helpers/contest-fixture'
import { createQueuedTrainingSubmission } from '../src/modules/training/training.submission.service'
import { saveTrainingRecord } from '../src/modules/training/application/training-user-content.service'
import { syncContestProblemStatus } from '../src/lib/submission-sync'
import { createTestUser } from './helpers/testUser'
import { createTestProblem } from './helpers/problemListHelpers'

async function createContestFixture() {
  const owner = await createTestUser({ organization: { role: 'teacher' } })
  const participant = await createTestUser({ organization: { role: 'student' } })
  const problem = await createTestProblem({ ownerId: owner.user.id, title: 'Canonical contest identity' })
  const runtime = await prisma.training.create({
    data: {
      title: 'Canonical identity contest',
      format: 'ioi',
      type: 'contest',
      scope: 'platform',
      startTime: new Date(Date.now() - 60_000),
      endTime: new Date(Date.now() + 60_000),
      status: 'ongoing',
      createdBy: owner.user.id,
    },
  })
  const contest = await prisma.$transaction(tx => ensureCanonicalContestFixtureTx(tx, runtime.id))
  const runtimeProblem = await prisma.trainingProblem.create({
    data: {
      id: crypto.randomUUID(),
      trainingId: runtime.id,
      problemId: problem.id,
      alias: 'A',
      orderIndex: 0,
      points: 100,
    },
  })
  const contestProblem = await prisma.$transaction(tx => syncCanonicalContestProblemFixtureTx(tx, runtimeProblem.id))
  if (!contest || !contestProblem) throw new Error('Failed to create canonical contest fixture')
  return { owner, participant, problem, runtime, contest, runtimeProblem, contestProblem }
}

describe('canonical contest submission identity', () => {
  it('writes only aggregate ids for new submissions and statuses', async () => {
    const fixture = await createContestFixture()
    const submission = await createQueuedTrainingSubmission({
      userId: fixture.participant.user.id,
      training: fixture.runtime,
      trainingProblem: {
        ...fixture.runtimeProblem,
        Problem: fixture.problem,
      },
      language: 'cpp',
      code: 'int main() { return 0; }',
      submitMethod: 'local',
    })

    expect(submission).toMatchObject({
      contestId: null,
      contestProblemId: null,
      canonicalContestId: fixture.contest.id,
      canonicalContestProblemId: fixture.contestProblem.id,
    })

    await syncContestProblemStatus(
      fixture.participant.user.id,
      fixture.contest.id,
      fixture.contestProblem.id,
      'accepted',
      100,
    )
    const status = await prisma.contestUserProblemStatus.findUniqueOrThrow({
      where: {
        contestId_userId_contestProblemId: {
          contestId: fixture.contest.id,
          userId: fixture.participant.user.id,
          contestProblemId: fixture.contestProblem.id,
        },
      },
    })
    expect(status).toMatchObject({
      contestId: fixture.contest.id,
      contestProblemId: fixture.contestProblem.id,
    })

    const record = await saveTrainingRecord(
      fixture.runtime.id,
      fixture.participant.user.id,
      'student',
      'contest notes',
    )
    expect(record?.canonicalContestId).toBe(fixture.contest.id)
  })

  it('keeps ordinary training records outside the Contest aggregate', async () => {
    const owner = await createTestUser({ organization: { role: 'teacher' } })
    const runtime = await prisma.training.create({
      data: {
        title: 'Ordinary training',
        format: 'ioi',
        type: 'training',
        scope: 'personal',
        startTime: new Date(),
        endTime: new Date(Date.now() + 60_000),
        createdBy: owner.user.id,
      },
    })
    const record = await saveTrainingRecord(runtime.id, owner.user.id, 'teacher', 'notes')
    expect(record?.canonicalContestId).toBeNull()
  })
})
