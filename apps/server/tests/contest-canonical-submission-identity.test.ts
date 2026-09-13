import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { ensureContestAggregateTx, syncContestProblemAggregateTx } from '../src/modules/contest/contest-aggregate.service'
import { createQueuedTrainingSubmission } from '../src/modules/training/training.submission.service'
import { saveTrainingRecord } from '../src/modules/training/application/training-user-content.service'
import { syncContestProblemStatus } from '../src/lib/submission-sync'
import { createTestUser } from './helpers/testUser'
import { createTestProblem } from './helpers/problemListHelpers'

async function createContestFixture() {
  const owner = await createTestUser({ role: 'teacher' })
  const participant = await createTestUser({ role: 'student' })
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
  const contest = await prisma.$transaction(tx => ensureContestAggregateTx(tx, runtime.id))
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
  const contestProblem = await prisma.$transaction(tx => syncContestProblemAggregateTx(tx, runtimeProblem.id))
  if (!contest || !contestProblem) throw new Error('Failed to create canonical contest fixture')
  return { owner, participant, problem, runtime, contest, runtimeProblem, contestProblem }
}

describe('canonical contest submission identity', () => {
  it('dual-writes aggregate ids for submissions, status and contest records', async () => {
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
      contestId: fixture.runtime.id,
      contestProblemId: fixture.runtimeProblem.id,
      canonicalContestId: fixture.contest.id,
      canonicalContestProblemId: fixture.contestProblem.id,
    })

    await syncContestProblemStatus(
      fixture.participant.user.id,
      fixture.runtime.id,
      fixture.runtimeProblem.id,
      'accepted',
      100,
      {
        canonicalContestId: fixture.contest.id,
        canonicalContestProblemId: fixture.contestProblem.id,
      },
    )
    const status = await prisma.contestUserProblemStatus.findUniqueOrThrow({
      where: {
        contestId_userId_contestProblemId: {
          contestId: fixture.runtime.id,
          userId: fixture.participant.user.id,
          contestProblemId: fixture.runtimeProblem.id,
        },
      },
    })
    expect(status).toMatchObject({
      canonicalContestId: fixture.contest.id,
      canonicalContestProblemId: fixture.contestProblem.id,
    })

    const record = await saveTrainingRecord(
      fixture.runtime.id,
      fixture.participant.user.id,
      'student',
      'contest notes',
    )
    expect(record?.canonicalContestId).toBe(fixture.contest.id)
  })

  it('fills canonical ids for an old compatible submission write', async () => {
    const fixture = await createContestFixture()
    const submission = await prisma.submission.create({
      data: {
        userId: fixture.participant.user.id,
        oj: 'carits',
        problemId: fixture.problem.problemId,
        problemInternalId: fixture.problem.id,
        language: 'cpp',
        code: 'int main() {}',
        codeLength: 13,
        submitMethod: 'local',
        submitScope: 'contest',
        trainingId: fixture.runtime.id,
        trainingProblemId: fixture.runtimeProblem.id,
      },
    })
    expect(submission).toMatchObject({
      contestId: fixture.runtime.id,
      contestProblemId: fixture.runtimeProblem.id,
      canonicalContestId: fixture.contest.id,
      canonicalContestProblemId: fixture.contestProblem.id,
    })
  })

  it('keeps ordinary training records outside the Contest aggregate', async () => {
    const owner = await createTestUser({ role: 'teacher' })
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

