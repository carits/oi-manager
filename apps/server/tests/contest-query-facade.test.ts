import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import {
  findContestForLicense,
  findContestForRating,
  findActivityForRanking,
  findActivityForSubmission,
  findActivityForAccess,
  findActivityForOverview,
  findContestForBlogReview,
  listDueRatedContests,
  listContestsForDashboard,
  listContestsForMaintenance,
  listFinishedContestPublicIds,
  listPlatformContests,
} from '../src/modules/contest/contest-query.facade'
import {
  deleteContestTx,
  holdContestFinalizationForRejudgeTx,
  prepareDemoContestsTx,
  transitionContestLifecycleTx,
  updateContestTx,
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
      id: crypto.randomUUID(), publicId: runtime.id, title: runtime.title,
      contestDate: runtime.startTime, startAt: runtime.startTime, endAt: runtime.endTime,
      format: runtime.format, status: runtime.status, type: 'judged', scope: 'platform',
    } })
    const resolved = await findContestForRating(runtime.id)
    expect(resolved).toMatchObject({ source: 'contest', contest: { id: contest.id }, activity: { id: runtime.id } })
    expect(await findContestForLicense(runtime.id)).toMatchObject({
      source: 'contest', contest: { id: contest.id }, activity: { id: runtime.id },
    })
    expect(await findActivityForRanking(runtime.id)).toMatchObject({
      source: 'contest', contest: { id: contest.id }, activity: { id: runtime.id },
    })
    expect(await findContestForBlogReview(runtime.id)).toMatchObject({
      source: 'contest', contest: { id: contest.id }, activity: { id: runtime.id },
    })
    expect(await findActivityForSubmission(runtime.id)).toMatchObject({
      source: 'contest', contest: { id: contest.id }, activity: { id: runtime.id },
    })
    expect(await findActivityForAccess(runtime.id)).toMatchObject({
      source: 'contest', contest: { id: contest.id }, activity: { id: runtime.id },
    })
    expect(await findActivityForOverview(runtime.id)).toMatchObject({
      source: 'contest', contest: { id: contest.id }, activity: { id: runtime.id },
    })
  })

  it('fails closed for an unmapped contest and lists only canonical aggregates', async () => {
    const mapped = await createRuntime('Mapped')
    await prisma.contest.create({ data: {
      id: crypto.randomUUID(), publicId: mapped.id, title: mapped.title,
      contestDate: mapped.startTime, startAt: mapped.startTime, endAt: mapped.endTime,
      format: mapped.format, status: mapped.status, type: 'judged', scope: 'platform',
    } })
    const legacy = await createRuntime('Legacy')
    expect(await findContestForRating(legacy.id)).toBeNull()
    expect(await findContestForLicense(legacy.id)).toBeNull()
    expect(await findActivityForRanking(legacy.id)).toBeNull()
    expect(await findContestForBlogReview(legacy.id)).toBeNull()
    expect(await findActivityForSubmission(legacy.id)).toBeNull()
    expect(await findActivityForAccess(legacy.id)).toBeNull()
    expect(await findActivityForOverview(legacy.id)).toBeNull()
    const rows = await listPlatformContests()
    expect(rows.map(row => row.id)).toEqual([mapped.id])
    const dashboardRows = await listContestsForDashboard({
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
    const mappedContest = await prisma.contest.create({ data: {
      id: crypto.randomUUID(), publicId: mapped.id, title: mapped.title,
      contestDate: mapped.startTime, startAt: mapped.startTime, endAt: mapped.endTime,
      format: mapped.format, status: mapped.status, type: 'judged', scope: 'platform',
    } })
    await prisma.contestRatingConfig.create({ data: {
      id: crypto.randomUUID(), contestId: mappedContest.id, track: 'IOI', scope: 'NONE',
      scoringRules: {}, rulesHash: 'mapped-rules', createdBy: mapped.createdBy,
    } })
    const legacy = await prisma.training.create({ data: {
      title: 'Due legacy', format: 'ioi', type: 'contest', scope: 'platform', status: 'finished',
      startTime: new Date('2026-01-02T00:00:00.000Z'), endTime: new Date('2026-01-02T02:00:00.000Z'),
      createdBy: crypto.randomUUID(),
    } })
    const due = await listDueRatedContests(new Date('2026-02-01T00:00:00.000Z'), 10)
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
      id: crypto.randomUUID(), publicId: finished.id, title: finished.title,
      contestDate: finished.startTime, startAt: finished.startTime, endAt: finished.endTime,
      format: finished.format, status: finished.status, type: 'judged', scope: finished.scope,
    } })
    const unmapped = await prisma.training.create({ data: {
      title: 'Canonical maintenance legacy', format: 'ioi', type: 'contest', scope: 'campus',
      status: 'finished',
      startTime: new Date('2026-01-02T00:00:00.000Z'), endTime: new Date('2026-01-02T02:00:00.000Z'),
      createdBy: crypto.randomUUID(),
    } })

    const discovered = await listContestsForMaintenance({
      titlePrefix: 'Canonical maintenance',
      scope: 'campus',
    })
    expect(discovered.map(row => row.id)).toEqual([finished.id])
    expect(await listFinishedContestPublicIds()).toContain(finished.id)
    expect(await listFinishedContestPublicIds()).not.toContain(unmapped.id)
  })

  it('updates demo time through Contest first and rolls the whole batch back on invalid targets', async () => {
    const mapped = await createRuntime('Demo canonical update')
    const contest = await prisma.contest.create({ data: {
      id: crypto.randomUUID(), publicId: mapped.id, title: mapped.title,
      contestDate: mapped.startTime, startAt: mapped.startTime, endAt: mapped.endTime,
      format: mapped.format, status: mapped.status, type: 'judged', scope: 'platform',
    } })
    const nextStart = new Date('2027-02-01T00:00:00.000Z')
    const nextEnd = new Date('2027-02-01T05:00:00.000Z')
    await prisma.$transaction(tx => prepareDemoContestsTx(tx, {
      publicIds: [mapped.id], startTime: nextStart, endTime: nextEnd,
    }))
    const [updatedContest, updatedRuntime] = await Promise.all([
      prisma.contest.findUniqueOrThrow({ where: { id: contest.id } }),
      prisma.training.findUniqueOrThrow({ where: { id: mapped.id } }),
    ])
    expect(updatedContest).toMatchObject({ status: 'ongoing', startAt: nextStart, endAt: nextEnd })
    expect(updatedRuntime).toMatchObject({ status: 'upcoming', startTime: mapped.startTime, endTime: mapped.endTime })

    const unmapped = await createRuntime('Demo unmapped target')
    const rejectedStart = new Date('2028-01-01T00:00:00.000Z')
    await expect(prisma.$transaction(tx => prepareDemoContestsTx(tx, {
      publicIds: [mapped.id, unmapped.id],
      startTime: rejectedStart,
      endTime: new Date('2028-01-01T02:00:00.000Z'),
    }))).rejects.toThrow('One or more demo contests do not exist')
    expect((await prisma.contest.findUniqueOrThrow({ where: { id: contest.id } })).startAt).toEqual(nextStart)
    expect((await prisma.training.findUniqueOrThrow({ where: { id: mapped.id } })).startTime).toEqual(mapped.startTime)
  })

  it('keeps ordinary training ranking reads outside contest fallback semantics', async () => {
    const training = await prisma.training.create({ data: {
      title: 'Ordinary training', format: 'oi', type: 'training', scope: 'personal', status: 'upcoming',
      startTime: new Date('2027-01-01T00:00:00.000Z'),
      endTime: new Date('2027-01-01T02:00:00.000Z'),
      createdBy: crypto.randomUUID(),
    } })
    expect(await findActivityForRanking(training.id)).toMatchObject({
      source: 'training', contest: null, activity: { id: training.id, type: 'training' },
    })
    expect(await findActivityForSubmission(training.id)).toMatchObject({
      source: 'training', contest: null, activity: { id: training.id, type: 'training' },
    })
    expect(await findActivityForAccess(training.id)).toMatchObject({
      source: 'training', contest: null, activity: { id: training.id, type: 'training' },
    })
    expect(await findActivityForOverview(training.id)).toMatchObject({
      source: 'training', contest: null, activity: { id: training.id, type: 'training' },
    })
  })

  it('rejects every canonical contest command when only a legacy runtime exists', async () => {
    const runtime = await createRuntime('Unmapped command target')

    const updated = await prisma.$transaction(tx => updateContestTx(tx, {
      publicId: runtime.id,
      expected: {
        status: runtime.status,
        format: runtime.format,
        startTime: runtime.startTime,
        endTime: runtime.endTime,
      },
      patch: { title: 'Must not be written' },
    }))
    expect(updated).toEqual({ conflict: 'missing', activity: null })

    const transitioned = await prisma.$transaction(tx => transitionContestLifecycleTx(tx, {
      publicId: runtime.id,
      actorUserId: runtime.createdBy,
      expectedStatus: runtime.status,
      targetStatus: 'ongoing',
    }))
    expect(transitioned).toBeNull()
    expect(await prisma.$transaction(tx => beginContestFinalizationTx(tx, runtime.id, 'LIVE'))).toBe(false)
    expect(await prisma.$transaction(tx => holdContestFinalizationForRejudgeTx(tx, runtime.id))).toBe(false)

    const deleted = await prisma.$transaction(tx => deleteContestTx(tx, runtime.id))
    expect(deleted.conflict).toBe('missing')
    expect(await prisma.training.findUnique({ where: { id: runtime.id } })).toMatchObject({
      title: 'Unmapped command target',
      status: 'upcoming',
    })
  })

  it('writes lifecycle and finalization state only to Contest', async () => {
    const runtime = await createRuntime('Canonical command source')
    const contest = await prisma.contest.create({ data: {
      id: crypto.randomUUID(), publicId: runtime.id, createdBy: runtime.createdBy,
      title: runtime.title, contestDate: runtime.startTime, startAt: runtime.startTime,
      endAt: runtime.endTime, format: runtime.format, status: runtime.status,
      type: 'judged', scope: runtime.scope,
    } })
    await prisma.contestRatingConfig.create({ data: {
      id: crypto.randomUUID(), contestId: contest.id, track: 'IOI', scope: 'NONE',
      scoringRules: {}, rulesHash: 'canonical-command-rules', createdBy: runtime.createdBy,
    } })

    const metadata = await prisma.$transaction(tx => updateContestTx(tx, {
      publicId: runtime.id,
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
      title: 'Canonical command source', problemIdVisible: false, solutionVisible: false,
      includeAdminInRanking: false,
    })

    const lifecycle = await prisma.$transaction(tx => transitionContestLifecycleTx(tx, {
      publicId: runtime.id,
      actorUserId: runtime.createdBy,
      expectedStatus: 'upcoming',
      targetStatus: 'ongoing',
    }))
    expect(lifecycle?.changed).toBe(true)
    expect(await prisma.contest.findUniqueOrThrow({ where: { id: contest.id } })).toMatchObject({
      status: 'ongoing', statusRevision: 2,
    })
    expect(await prisma.training.findUniqueOrThrow({ where: { id: runtime.id } })).toMatchObject({
      status: 'upcoming',
    })

    expect(await prisma.$transaction(tx => beginContestFinalizationTx(tx, runtime.id, 'LIVE'))).toBe(true)
    expect(await prisma.contest.findUniqueOrThrow({ where: { id: contest.id } })).toMatchObject({
      finalizationStatus: 'FINALIZING', statusRevision: 3,
    })
    expect(await prisma.training.findUniqueOrThrow({ where: { id: runtime.id } })).toMatchObject({
      finalizationStatus: 'LIVE',
    })

    const snapshot = await prisma.contestStandingSnapshot.create({ data: {
      id: crypto.randomUUID(), contestId: contest.id, revision: 1, scoringMode: 'IOI',
      rulesHash: 'canonical-command-rules', status: 'FINALIZED', inputHash: 'canonical-input',
      createdBy: runtime.createdBy, finalizedAt: new Date(),
    } })
    expect(await prisma.$transaction(tx => completeContestFinalizationTx(tx, runtime.id, snapshot.id))).toBe(true)
    expect(await prisma.contest.findUniqueOrThrow({ where: { id: contest.id } })).toMatchObject({
      status: 'finished', finalizationStatus: 'FINALIZED', finalizedStandingId: snapshot.id,
      statusRevision: 4,
    })
    expect(await prisma.training.findUniqueOrThrow({ where: { id: runtime.id } })).toMatchObject({
      status: 'upcoming', finalizationStatus: 'LIVE', finalizedStandingId: null,
    })
  })
})
