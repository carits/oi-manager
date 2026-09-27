import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import {
  TestSetSlotBusyError,
  acquireTestSetReader,
  captureEvolvingForPromotion,
  ensureInitialTestSetSlots,
  expireTestSetReaders,
  getTestSetSlotState,
  loadTestSetSlotSpec,
  promoteCapturedEvolving,
  reconcilePromotionWriters,
  recoverInterruptedTestSetWriters,
  releaseTestSetReader,
  replaceTestSetSlot,
  resolveConfigSpec,
  testSetSlotAbsolutePath,
  transitionJudgeMode,
} from '../src/modules/problem/problem.testset-slot.service'
import { createTestUser } from './helpers/testUser'
import {
  ContestRejudgeBarrierError,
  ensureContestRejudgeBarrierTx,
} from '../src/modules/contest/contest-command.service'

const root = path.join(process.cwd(), 'testdata')
const createdDirectories: string[] = []

async function fixture(dataContributionEnabled = true) {
  const owner = await createTestUser({ accountRole: 'platform_admin' })
  const problemId = crypto.randomUUID()
  const directory = path.join(root, problemId)
  createdDirectories.push(directory)
  await fs.promises.mkdir(directory, { recursive: true })
  await Promise.all([
    fs.promises.writeFile(path.join(directory, '1.in'), '1 2\n'),
    fs.promises.writeFile(path.join(directory, '1.out'), '3\n'),
    fs.promises.writeFile(path.join(directory, '1.ans'), '3\n'),
    fs.promises.writeFile(path.join(directory, 'checker.cpp'), '// checker\nint main(){}\n'),
  ])
  const config = ['mode: acm', 'checker_type: testlib', 'checker: checker.cpp', 'cases:', '  - input: 1.in', '    output: 1.out', ''].join('\n')
  const problem = await prisma.problem.create({ data: {
    id: problemId, platform: 'carits', problemId: `SLOT-${crypto.randomUUID()}`, title: 'Slot fixture',
    ownerType: 'platform_admin', ownerId: owner.user.id, libraryScope: 'platform', libraryKey: 'platform',
    visibility: 'public', status: 'published', judgeConfig: config, dataContributionEnabled,
  } })
  for (const filename of ['1.in', '1.out', '1.ans']) {
    const content = await fs.promises.readFile(path.join(directory, filename))
    await prisma.testdataFile.create({ data: {
      id: crypto.randomUUID(), problemId, filename, size: content.length,
      md5: crypto.createHash('md5').update(content).digest('hex'), sha256: crypto.createHash('sha256').update(content).digest('hex'),
    } })
  }
  await prisma.problemChecker.create({ data: {
    id: crypto.randomUUID(), problemId, fileName: 'checker.cpp',
    fileSize: (await fs.promises.stat(path.join(directory, 'checker.cpp'))).size,
    fileUrl: `/api/problems/${problemId}/checker/checker.cpp/download`, language: 'cpp',
  } })
  await ensureInitialTestSetSlots(problemId, owner.user.id)
  return { owner, problem, directory, config }
}

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map(directory => fs.promises.rm(directory, { recursive: true, force: true })))
})

describe('Stable/Evolving current TestSet slots', () => {
  it('keeps at most one Stable and one Evolving slot and no history identity', async () => {
    const { problem } = await fixture(true)
    const slots = await getTestSetSlotState(problem.id)
    expect(slots.map(item => item.slot)).toEqual(['STABLE', 'EVOLVING'])
    expect(new Set(slots.map(item => `${item.problemId}:${item.slot}`)).size).toBe(2)
    expect(slots.every(item => !('revisionId' in item))).toBe(true)
    for (const slot of await prisma.problemTestSetSlot.findMany({ where: { problemId: problem.id } })) {
      expect(fs.existsSync(testSetSlotAbsolutePath(problem.id, slot))).toBe(true)
    }
  })


  it('keeps the Stable compatibility config unchanged when Evolving advances', async () => {
    const { problem, config, owner } = await fixture(true)
    const stableConfig = (await prisma.problem.findUniqueOrThrow({
      where: { id: problem.id },
      select: { judgeConfig: true },
    })).judgeConfig
    const evolving = await prisma.problemTestSetSlot.findUniqueOrThrow({
      where: { problemId_slot: { problemId: problem.id, slot: 'EVOLVING' } },
    })
    const spec = (await loadTestSetSlotSpec(problem.id, 'EVOLVING'))!
    spec.cases![0].time = '2s'
    await replaceTestSetSlot({
      problemId: problem.id, slot: 'EVOLVING', source: 'contribution', sourceId: crypto.randomUUID(),
      requestedBy: owner.user.id, baseConfigText: config, spec, expectedFencingToken: evolving.fencingToken,
    })
    expect((await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).judgeConfig).toBe(stableConfig)
    expect((await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: problem.id, slot: 'EVOLVING' } } })).judgeConfig).not.toBe(stableConfig)
  })
  it('closes the reader gate before waiting and keeps Stable/Evolving independent', async () => {
    const { problem, config } = await fixture(true)
    const stable = await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: problem.id, slot: 'STABLE' } } })
    const reader = await acquireTestSetReader({ problemId: problem.id, slot: 'STABLE', ownerType: 'CONTEST_PROBLEM', ownerId: crypto.randomUUID() })
    const spec = await loadTestSetSlotSpec(problem.id, 'STABLE')
    const writer = await replaceTestSetSlot({
      problemId: problem.id, slot: 'STABLE', source: 'admin_edit', sourceId: crypto.randomUUID(),
      baseConfigText: config, spec: spec!, expectedFencingToken: stable.fencingToken,
    })
    expect(writer.status).toBe('DRAINING')
    await expect(acquireTestSetReader({ problemId: problem.id, slot: 'STABLE', ownerType: 'JUDGE_RUN', ownerId: crypto.randomUUID() })).rejects.toBeInstanceOf(TestSetSlotBusyError)
    const evolvingReader = await acquireTestSetReader({ problemId: problem.id, slot: 'EVOLVING', ownerType: 'JUDGE_RUN', ownerId: crypto.randomUUID() })
    await releaseTestSetReader(evolvingReader.reader.id)
    await releaseTestSetReader(reader.reader.id)
    expect((await prisma.problemTestSetWriter.findUniqueOrThrow({ where: { id: writer.id } })).status).toBe('SUCCEEDED')
    expect((await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: problem.id, slot: 'STABLE' } } })).fencingToken).toBe(stable.fencingToken + 1)
  })

  it('expires abandoned readers and lets the queued writer finish', async () => {
    const { problem, config } = await fixture(false)
    const slot = await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: problem.id, slot: 'STABLE' } } })
    await acquireTestSetReader({ problemId: problem.id, slot: 'STABLE', ownerType: 'DATA_EXPORT', ownerId: crypto.randomUUID(), expiresAt: new Date(Date.now() - 1_000) })
    const writer = await replaceTestSetSlot({ problemId: problem.id, slot: 'STABLE', source: 'admin_edit', sourceId: crypto.randomUUID(), baseConfigText: config, spec: (await loadTestSetSlotSpec(problem.id, 'STABLE'))!, expectedFencingToken: slot.fencingToken })
    expect(writer.status).toBe('DRAINING')
    expect(await expireTestSetReaders()).toEqual({ expired: 1 })
    expect((await prisma.problemTestSetWriter.findUniqueOrThrow({ where: { id: writer.id } })).status).toBe('SUCCEEDED')
  })

  it('recovers an interrupted applying writer without opening the reader gate', async () => {
    const { problem, config } = await fixture(false)
    const slot = await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: problem.id, slot: 'STABLE' } } })
    const reader = await acquireTestSetReader({ problemId: problem.id, slot: 'STABLE', ownerType: 'CONTEST_PROBLEM', ownerId: crypto.randomUUID() })
    const writer = await replaceTestSetSlot({ problemId: problem.id, slot: 'STABLE', source: 'admin_edit', sourceId: crypto.randomUUID(), baseConfigText: config, spec: (await loadTestSetSlotSpec(problem.id, 'STABLE'))!, expectedFencingToken: slot.fencingToken })
    await prisma.problemTestSetWriter.update({ where: { id: writer.id }, data: { status: 'APPLYING', startedAt: new Date(Date.now() - 5 * 60_000) } })
    expect(await recoverInterruptedTestSetWriters()).toEqual({ scanned: 1, recovered: 1, failed: 0 })
    expect((await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: problem.id, slot: 'STABLE' } } })).writerGateClosed).toBe(true)
    await releaseTestSetReader(reader.reader.id)
    expect((await prisma.problemTestSetWriter.findUniqueOrThrow({ where: { id: writer.id } })).status).toBe('SUCCEEDED')
  })

  it('promotes the captured Evolving snapshot, not a later Evolving replacement', async () => {
    const { problem, config, owner } = await fixture(true)
    const stableReader = await acquireTestSetReader({ problemId: problem.id, slot: 'STABLE', ownerType: 'CONTEST_PROBLEM', ownerId: crypto.randomUUID() })
    const captured = await captureEvolvingForPromotion({ problemId: problem.id, requestedBy: owner.user.id })
    const evolving = await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: problem.id, slot: 'EVOLVING' } } })
    const later = (await loadTestSetSlotSpec(problem.id, 'EVOLVING'))!
    later.cases![0].time = '2s'
    await replaceTestSetSlot({ problemId: problem.id, slot: 'EVOLVING', source: 'contribution', sourceId: crypto.randomUUID(), requestedBy: owner.user.id, baseConfigText: config, spec: later, expectedFencingToken: evolving.fencingToken })
    const laterEvolving = await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: problem.id, slot: 'EVOLVING' } } })
    expect(laterEvolving.graphHash).not.toBe(captured.graphHash)

    await expect(promoteCapturedEvolving({ jobId: captured.jobId, validationReport: { outcome: 'failed' }, validatorPassed: false, standardPassed: true, acceptedReplayPassed: true })).rejects.toThrow('未全部通过')
    const writer = await promoteCapturedEvolving({ jobId: captured.jobId, validationReport: { outcome: 'passed' }, validatorPassed: true, standardPassed: true, acceptedReplayPassed: true, requestedBy: owner.user.id })
    expect(writer.status).toBe('DRAINING')
    await releaseTestSetReader(stableReader.reader.id)
    await reconcilePromotionWriters()
    const [stable, job] = await Promise.all([
      prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: problem.id, slot: 'STABLE' } } }),
      prisma.problemTestSetPromotionJob.findUniqueOrThrow({ where: { id: captured.jobId } }),
    ])
    expect(stable.graphHash).toBe(captured.graphHash)
    expect(stable.graphHash).not.toBe(laterEvolving.graphHash)
    expect(job.status).toBe('succeeded')
  })

  it('re-establishes a Contest barrier only while the captured Stable slot is unchanged', async () => {
    const { problem, config } = await fixture(false)
    const stable = await prisma.problemTestSetSlot.findUniqueOrThrow({
      where: { problemId_slot: { problemId: problem.id, slot: 'STABLE' } },
    })
    const contest = await prisma.contest.create({
      data: {
        id: crypto.randomUUID(),
        title: 'Stable barrier fixture',
        contestDate: new Date(),
        status: 'finished',
      },
    })
    const contestProblem = await prisma.contestProblem.create({
      data: {
        id: crypto.randomUUID(),
        contestId: contest.id,
        canonicalProblemId: problem.id,
        testSetSlot: 'STABLE',
        testSetGraphHash: stable.graphHash,
        testSetJudgeConfigHash: stable.judgeConfigHash,
        testSetFencingToken: stable.fencingToken,
        orderIndex: 0,
      },
    })

    await prisma.$transaction(tx => ensureContestRejudgeBarrierTx(tx, contest.id))
    const held = await prisma.contestProblem.findUniqueOrThrow({ where: { id: contestProblem.id } })
    expect(held.testSetReaderId).toBeTruthy()
    expect((await prisma.problemTestSetSlot.findUniqueOrThrow({
      where: { problemId_slot: { problemId: problem.id, slot: 'STABLE' } },
    })).activeReaderCount).toBe(1)

    await releaseTestSetReader(held.testSetReaderId!)
    await prisma.contestProblem.update({
      where: { id: contestProblem.id },
      data: { testSetReaderId: null },
    })
    await replaceTestSetSlot({
      problemId: problem.id,
      slot: 'STABLE',
      source: 'admin_edit',
      sourceId: crypto.randomUUID(),
      baseConfigText: config,
      spec: (await loadTestSetSlotSpec(problem.id, 'STABLE'))!,
      expectedFencingToken: stable.fencingToken,
    })

    await expect(prisma.$transaction(tx => ensureContestRejudgeBarrierTx(tx, contest.id)))
      .rejects.toBeInstanceOf(ContestRejudgeBarrierError)
    expect((await prisma.contestProblem.findUniqueOrThrow({
      where: { id: contestProblem.id },
    })).testSetReaderId).toBeNull()
    expect((await prisma.problemTestSetSlot.findUniqueOrThrow({
      where: { problemId_slot: { problemId: problem.id, slot: 'STABLE' } },
    })).activeReaderCount).toBe(0)
  })

  it('changes judge mode by replacing the selected slot in place', async () => {
    const { problem, owner } = await fixture(false)
    const stable = await prisma.problemTestSetSlot.findUniqueOrThrow({ where: { problemId_slot: { problemId: problem.id, slot: 'STABLE' } } })
    const writer = await transitionJudgeMode({ problemId: problem.id, targetMode: 'oi', slot: 'STABLE', expectedFencingToken: stable.fencingToken, updatedBy: owner.user.id })
    expect(writer.status).toBe('SUCCEEDED')
    const rows = await prisma.problemTestSetSlot.findMany({ where: { problemId: problem.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ slot: 'STABLE', mode: 'oi', source: 'mode_transition', fencingToken: stable.fencingToken + 1 })
  })

  it('normalizes legacy string subtask ids without creating a revision', async () => {
    const { problem } = await fixture(false)
    const spec = await resolveConfigSpec(problem.id, ['mode: oi', 'subtasks:', '  - id: all', '    score: 100', '    scoring: sum', '    cases: [1]', ''].join('\n'))
    expect(spec.subtasks?.[0]).toMatchObject({ id: 1, score: 100, if: [] })
    expect(spec.subtasks?.[0].groups[0]).toMatchObject({ key: 'official-1', type: 'sum' })
  })
})