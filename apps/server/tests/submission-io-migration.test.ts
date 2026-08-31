import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { createQueuedSubmissionWithRun } from '../src/modules/judge/application/judge-run.service'
import {
  applySubmissionIoMigration,
  inspectSubmissionIoMigration,
} from '../src/modules/maintenance/application/submission-io-migration.service'

describe('legacy submission IO migration', () => {
  it('backfills Submission and JudgeRun once without changing the result', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const userId = `io-migration-user-${suffix}`
    const problemId = `io-migration-problem-${suffix}`
    await prisma.user.create({ data: {
      id: userId, username: userId, passwordHash: 'test', role: 'student', status: 'active',
    } })
    await prisma.problem.create({ data: {
      id: problemId, platform: 'carits', problemId, title: 'Legacy FileIO',
      ownerId: userId, ownerType: 'user', visibility: 'private', status: 'published',
      judgeConfig: 'type: default\nfilename: travel\ncases: []\n',
    } })
    const submission = await createQueuedSubmissionWithRun({
      userId, oj: 'carits', problemId, problemInternalId: problemId,
      language: 'cpp17', code: 'int main(){}', codeLength: 12,
      result: 'queuing', submitMethod: 'local', submitScope: 'problem',
    })
    await prisma.submission.update({ where: { id: submission.id }, data: { ioAdapterVersion: 0 } })
    await prisma.judgeRun.updateMany({ where: { submissionId: submission.id }, data: { ioAdapterVersion: 0 } })

    expect(await inspectSubmissionIoMigration()).toMatchObject({ pending: 1, resolvable: 1, fileIo: 1, unresolved: [] })
    expect(await applySubmissionIoMigration()).toMatchObject({ migrated: 1, remaining: 0, unresolved: [] })
    expect(await applySubmissionIoMigration()).toMatchObject({ migrated: 0, remaining: 0, unresolved: [] })

    const stored = await prisma.submission.findUniqueOrThrow({
      where: { id: submission.id }, include: { CurrentJudgeRun: true },
    })
    expect(stored).toMatchObject({
      result: 'queuing', inputFilename: 'travel.in', outputFilename: 'travel.out', ioAdapterVersion: 1,
    })
    expect(stored.CurrentJudgeRun).toMatchObject({
      status: 'QUEUED', inputFilename: 'travel.in', outputFilename: 'travel.out', ioAdapterVersion: 1,
    })
  })
})
