import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import {
  findContestRuntimeForLicense,
  findContestRuntimeForRating,
  findActivityRuntimeForRanking,
  findActivityRuntimeForSubmission,
  findActivityRuntimeForAccess,
  findActivityRuntimeForOverview,
  findContestRuntimeForBlogReview,
  listDueRatedContestRuntimes,
  listContestRuntimesForDashboard,
  listCanonicalContestRuntimesForMaintenance,
  listFinishedContestRuntimeIds,
  listPlatformContestRuntimes,
} from '../src/modules/contest/contest-query.facade'
import {
  deleteContestRuntimeTx,
  holdContestFinalizationForRejudgeTx,
  prepareDemoContestRuntimesTx,
  transitionContestLifecycleTx,
  updateContestRuntimeTx,
} from '../src/modules/contest/contest-command.service'
import {
  beginContestFinalizationTx,
  completeContestFinalizationTx,
} from '../src/modules/contest/contest-finalization-command.service'

async function createRuntime(title: string) {
  return prisma.training.create({ data: {
    title, format: 'ioi', type: 'contest', scope: 'platform', status: 'upcoming',
    startTime: new Date('2027-01-01T00:00:00.000Z'),
    endTime: new Date('2027-01-01T02:00:00.000Z'),
    createdBy: crypto.randomUUID(),
  } })
}

describe('Contest query facade', () => {
  it('resolves a mapped contest through the canonical aggregate', async () => {
    const runtime = await createRuntime('Mapped contest')
    const contest = await prisma.contest.create({ data: {
      id: crypto.randomUUID(), runtimeTrainingId: runtime.id, title: runtime.title,
      contestDate: runtime.startTime, startAt: runtime.startTime, endAt: runtime.endTime,
      format: runtime.format, status: runtime.status, type: 'judged', scope: 'platform',
    } })
    const resolved = await findContestRuntimeForRating(runtime.id)
    expect(resolved).toMatchObject({ source: 'aggregate', contest: { id: contest.id }, runtime: { id: runtime.id } })
    expect(await findContestRuntimeForLicense(runtime.id)).toMatchObject({
      source: 'aggregate', contest: { id: contest.id }, runtime: { id: runtime.id },
    })
    expect(await findActivityRuntimeForRanking(runtime.id)).toMatchObject({
      source: 'aggregate', contest: { id: contest.id }, runtime: { id: runtime.id },
    })
    expect(await findContestRuntimeForBlogReview(runtime.id)).toMatchObject({
      source: 'aggregate', contest: { id: contest.id }, runtime: { id: runtime.id },
    })
    expect(await findActivityRuntimeForSubmission(runtime.id)).toMatchObject({
      source: 'aggregate', contest: { id: contest.id }, runtime: { id: runtime.id },
    })
    expect(await findActivityRuntimeForAccess(runtime.id)).toMatchObject({
      source: 'aggregate', contest: { id: contest.id }, runtime: { id: runtime.id },
    })
    expect(await findActivityRuntimeForOverview(runtime.id)).toMatchObject({
      source: 'aggregate', contest: { id: contest.id }, runtime: { id: runtime.id },
    })
  })

  it('fails closed for an unmapped contest and lists only canonical aggregates', async () => {
    const mapped = await createRuntime('Mapped')
    await prisma.contest.create({ data: {
      id: crypto.randomUUID(), runtimeTrainingId: mapped.id, title: mapped.title,
      contestDate: mapped.startTime, startAt: mapped.startTime, endAt: mapped.endTime,
      format: mapped.format, status: mapped.status, type: 'judged', scope: 'platform',
    } })
    const legacy = await createRuntime('Legacy')
    expect(await findContestRuntimeForRating(legacy.id)).toBeNull()
    expect(await findContestRuntimeForLicense(legacy.id)).toBeNull()
    expect(await findActivityRuntimeForRanking(legacy.id)).toBeNull()
    expect(await findContestRuntimeForBlogReview(legacy.id)).toBeNull()
    expect(await findActivityRuntimeForSubmission(legacy.id)).toBeNull()
    expect(await findActivityRuntimeForAccess(legacy.id)).toBeNull()
    expect(await findActivityRuntimeForOverview(legacy.id)).toBeNull()
    const rows = await listPlatformContestRuntimes()
    expect(rows.map(row => row.id)).toEqual([mapped.id])
    const dashboardRows = await listContestRuntimesForDashboard({
      teamIds: [],
      resourceScope: 'personal',
      organizationId: null,
    })
    expect(dashboardRows.map(row => row.id)).toEqual([mapped.id])
  })

  it('discovers due Rating work only through mapped aggregates', async () => {
    const mapped = await prisma.training.create({ data: {
      title: 'Due mapped', format: 'ioi', type: 'contest', scope: 'platform', status: 'finished',
      startTime: new Date('2026-01-01T00:00:00.000Z'), endTime: new Date('2026-01-01T02:00:00.000Z'),
      createdBy: crypto.randomUUID(),
    } })
    await prisma.contest.create({ data: {
      id: crypto.randomUUID(), runtimeTrainingId: mapped.id, title: mapped.title,
      contestDate: mapped.startTime, startAt: mapped.startTime, endAt: mapped.endTime,
      format: mapped.format, status: mapped.status, type: 'judged', scope: 'platform',
    } })
    await prisma.trainingRatingConfig.create({ data: {
      id: crypto.randomUUID(), trainingId: mapped.id, track: 'IOI', scope: 'NONE',
      scoringRules: {}, rulesHash: 'mapped-rules', createdBy: mapped.createdBy,
    } })
    const legacy = await prisma.training.create({ data: {
      title: 'Due legacy', format: 'ioi', type: 'contest', scope: 'platform', status: 'finished',
      startTime: new Date('2026-01-02T00:00:00.000Z'), endTime: new Date('2026-01-02T02:00:00.000Z'),
      createdBy: crypto.randomUUID(),
    } })
    await prisma.trainingRatingConfig.create({ data: {
      id: crypto.randomUUID(), trainingId: legacy.id, track: 'IOI', scope: 'NONE',
      scoringRules: {}, rulesHash: 'legacy-rules', createdBy: legacy.createdBy,
    } })

    const due = await listDueRatedContestRuntimes(new Date('2026-02-01T00:00:00.000Z'), 10)
    expect(due.map(row => row.id)).toEqual([mapped.id])
  })

  it('keeps maintenance discovery and visibility repair on canonical contests', async () => {
    const finished = await prisma.training.create({ data: {
      title: 'Canonical maintenance contest', format: 'ioi', type: 'contest', scope: 'campus',
      status: 'finished',
      startTime: new Date('2026-01-01T00:00:00.000Z'), endTime: new Date('2026-01-01T02:00:00.000Z'),
      createdBy: crypto.randomUUID(),
    } })
    await prisma.contest.create({ data: {
      id: crypto.randomUUID(), runtimeTrainingId: finished.id, title: finished.title,
      contestDate: finished.startTime, startAt: finished.startTime, endAt: finished.endTime,
      format: finished.format, status: finished.status, type: 'judged', scope: finished.scope,
    } })
    const unmapped = await prisma.training.create({ data: {
      title: 'Canonical maintenance legacy', format: 'ioi', type: 'contest', scope: 'campus',
      status: 'finished',
      startTime: new Date('2026-01-02T00:00:00.000Z'), endTime: new Date('2026-01-02T02:00:00.000Z'),
      createdBy: crypto.randomUUID(),
    } })

    const discovered = await listCanonicalContestRuntimesForMaintenance({
      titlePrefix: 'Canonical maintenance',
      scope: 'campus',
    })
    expect(discovered.map(row => row.id)).toEqual([finished.id])
    expect(await listFinishedContestRuntimeIds()).toContain(finished.id)
    expect(await listFinishedContestRuntimeIds()).not.toContain(unmapped.id)
  })

  it('updates demo time through Contest first and rolls the whole batch back on invalid targets', async () => {
    const mapped = await createRuntime('Demo canonical update')
    const contest = await prisma.contest.create({ data: {
      id: crypto.randomUUID(), runtimeTrainingId: mapped.id, title: mapped.title,
      contestDate: mapped.startTime, startAt: mapped.startTime, endAt: mapped.endTime,
      format: mapped.format, status: mapped.status, type: 'judged', scope: 'platform',
    } })
    const nextStart = new Date('2027-02-01T00:00:00.000Z')
    const nextEnd = new Date('2027-02-01T05:00:00.000Z')
    await prisma.$transaction(tx => prepareDemoContestRuntimesTx(tx, {
      runtimeTrainingIds: [mapped.id], startTime: nextStart, endTime: nextEnd,
    }))
    const [updatedContest, updatedRuntime] = await Promise.all([
      prisma.contest.findUniqueOrThrow({ where: { id: contest.id } }),
      prisma.training.findUniqueOrThrow({ where: { id: mapped.id } }),
    ])
    expect(updatedContest).toMatchObject({ status: 'ongoing', startAt: nextStart, endAt: nextEnd })
    expect(updatedRuntime).toMatchObject({ status: 'ongoing', startTime: nextStart, endTime: nextEnd })

    const unmapped = await createRuntime('Demo unmapped target')
    const rejectedStart = new Date('2028-01-01T00:00:00.000Z')
    await expect(prisma.$transaction(tx => prepareDemoContestRuntimesTx(tx, {
      runtimeTrainingIds: [mapped.id, unmapped.id],
      startTime: rejectedStart,
      endTime: new Date('2028-01-01T02:00:00.000Z'),
    }))).rejects.toThrow('has no canonical aggregate')
    expect((await prisma.contest.findUniqueOrThrow({ where: { id: contest.id } })).startAt).toEqual(nextStart)
    expect((await prisma.training.findUniqueOrThrow({ where: { id: mapped.id } })).startTime).toEqual(nextStart)
  })

  it('keeps ordinary training ranking reads outside contest fallback semantics', async () => {
    const training = await prisma.training.create({ data: {
      title: 'Ordinary training', format: 'oi', type: 'training', scope: 'personal', status: 'upcoming',
      startTime: new Date('2027-01-01T00:00:00.000Z'),
      endTime: new Date('2027-01-01T02:00:00.000Z'),
      createdBy: crypto.randomUUID(),
    } })
    expect(await findActivityRuntimeForRanking(training.id)).toMatchObject({
      source: 'training', contest: null, runtime: { id: training.id, type: 'training' },
    })
    expect(await findActivityRuntimeForSubmission(training.id)).toMatchObject({
      source: 'training', contest: null, runtime: { id: training.id, type: 'training' },
    })
    expect(await findActivityRuntimeForAccess(training.id)).toMatchObject({
      source: 'training', contest: null, runtime: { id: training.id, type: 'training' },
    })
    expect(await findActivityRuntimeForOverview(training.id)).toMatchObject({
      source: 'training', contest: null, runtime: { id: training.id, type: 'training' },
    })
  })

  it('rejects every canonical contest command when only a legacy runtime exists', async () => {
    const runtime = await createRuntime('Unmapped command target')

    const updated = await prisma.$transaction(tx => updateContestRuntimeTx(tx, {
      runtimeTrainingId: runtime.id,
      expected: {
        status: runtime.status,
        format: runtime.format,
        startTime: runtime.startTime,
        endTime: runtime.endTime,
      },
      patch: { title: 'Must not be written' },
    }))
    expect(updated).toEqual({ conflict: 'missing', runtime: null })

    const transitioned = await prisma.$transaction(tx => transitionContestLifecycleTx(tx, {
      runtimeTrainingId: runtime.id,
      actorUserId: runtime.createdBy,
      expectedStatus: runtime.status,
      targetStatus: 'ongoing',
    }))
    expect(transitioned).toBeNull()
    expect(await prisma.$transaction(tx => beginContestFinalizationTx(tx, runtime.id, 'LIVE'))).toBe(false)
    expect(await prisma.$transaction(tx => holdContestFinalizationForRejudgeTx(tx, runtime.id))).toBe(false)

    const deleted = await prisma.$transaction(tx => deleteContestRuntimeTx(tx, runtime.id))
    expect(deleted.conflict).toBe('missing')
    expect(await prisma.training.findUnique({ where: { id: runtime.id } })).toMatchObject({
      title: 'Unmapped command target',
      status: 'upcoming',
    })
  })

  it('writes lifecycle and finalization state to Contest before projecting Training', async () => {
    const runtime = await createRuntime('Canonical command source')
    const contest = await prisma.contest.create({ data: {
      id: crypto.randomUUID(), runtimeTrainingId: runtime.id, createdBy: runtime.createdBy,
      title: runtime.title, contestDate: runtime.startTime, startAt: runtime.startTime,
      endAt: runtime.endTime, format: runtime.format, status: runtime.status,
      type: 'judged', scope: runtime.scope,
    } })
    await prisma.trainingRatingConfig.create({ data: {
      id: crypto.randomUUID(), trainingId: runtime.id, track: 'IOI', scope: 'NONE',
      scoringRules: {}, rulesHash: 'canonical-command-rules', createdBy: runtime.createdBy,
    } })

    const metadata = await prisma.$transaction(tx => updateContestRuntimeTx(tx, {
      runtimeTrainingId: runtime.id,
      expected: {
        status: runtime.status,
        format: runtime.format,
        startTime: runtime.startTime,
        endTime: runtime.endTime,
      },
      patch: {
        title: 'Canonical title',
        problemIdVisible: true,
        solutionVisible: true,
        includeAdminInRanking: true,
      },
    }))
    expect(metadata.conflict).toBeNull()
    expect(await prisma.contest.findUniqueOrThrow({ where: { id: contest.id } })).toMatchObject({
      title: 'Canonical title', problemIdVisible: true, solutionVisible: true,
      includeAdminInRanking: true, statusRevision: 1,
    })
    expect(await prisma.training.findUniqueOrThrow({ where: { id: runtime.id } })).toMatchObject({
      title: 'Canonical title', problemIdVisible: true, solutionVisible: true,
      includeAdminInRanking: true,
    })

    const lifecycle = await prisma.$transaction(tx => transitionContestLifecycleTx(tx, {
      runtimeTrainingId: runtime.id,
      actorUserId: runtime.createdBy,
      expectedStatus: 'upcoming',
      targetStatus: 'ongoing',
    }))
    expect(lifecycle?.changed).toBe(true)
    expect(await prisma.contest.findUniqueOrThrow({ where: { id: contest.id } })).toMatchObject({
      status: 'ongoing', statusRevision: 2,
    })
    expect(await prisma.training.findUniqueOrThrow({ where: { id: runtime.id } })).toMatchObject({
      status: 'ongoing',
    })

    expect(await prisma.$transaction(tx => beginContestFinalizationTx(tx, runtime.id, 'LIVE'))).toBe(true)
    expect(await prisma.contest.findUniqueOrThrow({ where: { id: contest.id } })).toMatchObject({
      finalizationStatus: 'FINALIZING', statusRevision: 3,
    })
    expect(await prisma.training.findUniqueOrThrow({ where: { id: runtime.id } })).toMatchObject({
      finalizationStatus: 'FINALIZING',
    })

    const snapshot = await prisma.contestStandingSnapshot.create({ data: {
      id: crypto.randomUUID(), trainingId: runtime.id, revision: 1, scoringMode: 'IOI',
      rulesHash: 'canonical-command-rules', status: 'FINALIZED', inputHash: 'canonical-input',
      createdBy: runtime.createdBy, finalizedAt: new Date(),
    } })
    expect(await prisma.$transaction(tx => completeContestFinalizationTx(tx, runtime.id, snapshot.id))).toBe(true)
    expect(await prisma.contest.findUniqueOrThrow({ where: { id: contest.id } })).toMatchObject({
      status: 'finished', finalizationStatus: 'FINALIZED', finalizedStandingId: snapshot.id,
      statusRevision: 4,
    })
    expect(await prisma.training.findUniqueOrThrow({ where: { id: runtime.id } })).toMatchObject({
      status: 'finished', finalizationStatus: 'FINALIZED', finalizedStandingId: snapshot.id,
    })
  })
})
