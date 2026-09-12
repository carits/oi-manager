import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import {
  findContestRuntimeForLicense,
  findContestRuntimeForRating,
  findActivityRuntimeForRanking,
  findActivityRuntimeForSubmission,
  findContestRuntimeForBlogReview,
  listDueRatedContestRuntimes,
  listContestRuntimesForDashboard,
  listPlatformContestRuntimes,
} from '../src/modules/contest/contest-query.facade'

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
  })

  it('contains legacy fallback inside the facade and returns each platform contest once', async () => {
    const mapped = await createRuntime('Mapped')
    await prisma.contest.create({ data: {
      id: crypto.randomUUID(), runtimeTrainingId: mapped.id, title: mapped.title,
      contestDate: mapped.startTime, startAt: mapped.startTime, endAt: mapped.endTime,
      format: mapped.format, status: mapped.status, type: 'judged', scope: 'platform',
    } })
    const legacy = await createRuntime('Legacy')
    expect(await findContestRuntimeForRating(legacy.id)).toMatchObject({ source: 'legacy', runtime: { id: legacy.id } })
    expect(await findContestRuntimeForLicense(legacy.id)).toMatchObject({ source: 'legacy', runtime: { id: legacy.id } })
    expect(await findActivityRuntimeForRanking(legacy.id)).toMatchObject({ source: 'legacy', runtime: { id: legacy.id } })
    expect(await findContestRuntimeForBlogReview(legacy.id)).toMatchObject({ source: 'legacy', runtime: { id: legacy.id } })
    expect(await findActivityRuntimeForSubmission(legacy.id)).toMatchObject({ source: 'legacy', runtime: { id: legacy.id } })
    const rows = await listPlatformContestRuntimes()
    expect(rows.map(row => row.id).sort((a, b) => a - b)).toEqual([mapped.id, legacy.id].sort((a, b) => a - b))
    const dashboardRows = await listContestRuntimesForDashboard({
      teamIds: [],
      resourceScope: 'personal',
      organizationId: null,
    })
    expect(dashboardRows.map(row => row.id).sort((a, b) => a - b))
      .toEqual([mapped.id, legacy.id].sort((a, b) => a - b))
  })

  it('discovers due Rating work through mapped aggregates and bounded legacy fallback', async () => {
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
    expect(due.map(row => row.id)).toEqual([mapped.id, legacy.id])
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
  })
})
