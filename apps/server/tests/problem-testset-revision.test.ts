import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import {
  TestSetRevisionConflict,
  ensureInitialTestSetRevision,
  ingestTestdataObject,
  inspectTestSetRevisionMigration,
  loadRevisionSpec,
  migrateProblemTestSetRevisions,
  publishTestSetRevision,
  resolveConfigSpec,
  transitionJudgeMode,
} from '../src/modules/problem/problem.testset-revision.service'
import { collectOrphanTestdataObjects } from '../src/lib/testdata-object-gc'
import { createTestTeam, createTestUser } from './helpers/testUser'
import {
  previewTrainingTestSetUpdate,
  updateTrainingTestSetRevision,
} from '../src/modules/training/application/training-testset-update.service'

const root = path.join(process.cwd(), 'testdata')
const createdDirectories: string[] = []

async function fixture() {
  const owner = await createTestUser({ accountRole: 'platform_admin' })
  const problemId = crypto.randomUUID()
  const directory = path.join(root, problemId)
  createdDirectories.push(directory)
  await fs.promises.mkdir(directory, { recursive: true })
  await Promise.all([
    fs.promises.writeFile(path.join(directory, '1.in'), '1 2\n'),
    fs.promises.writeFile(path.join(directory, '1.out'), '3\n'),
    fs.promises.writeFile(path.join(directory, '1.ans'), '3\n'),
    fs.promises.writeFile(path.join(directory, 'checker.cpp'), '// checker v1\nint main(){}\n'),
  ])
  const config = [
    'mode: acm',
    'checker_type: testlib',
    'checker: checker.cpp',
    'cases:',
    '  - input: 1.in',
    '    output: 1.out',
    '',
  ].join('\n')
  const problem = await prisma.problem.create({ data: {
    id: problemId,
    platform: 'carits',
    problemId: `REV-${crypto.randomUUID()}`,
    title: 'Revision fixture',
    ownerType: 'platform_admin',
    ownerId: owner.user.id,
    libraryScope: 'platform',
    libraryKey: 'platform',
    visibility: 'public',
    status: 'published',
    judgeConfig: config,
  } })
  for (const filename of ['1.in', '1.out', '1.ans']) {
    const content = await fs.promises.readFile(path.join(directory, filename))
    await prisma.testdataFile.create({ data: {
      id: crypto.randomUUID(), problemId, filename, size: content.length,
      md5: crypto.createHash('md5').update(content).digest('hex'),
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    } })
  }
  await prisma.problemChecker.create({ data: {
    id: crypto.randomUUID(),
    problemId,
    fileName: 'checker.cpp',
    fileSize: (await fs.promises.stat(path.join(directory, 'checker.cpp'))).size,
    fileUrl: `/api/problems/${problemId}/checker/checker.cpp/download`,
    language: 'cpp',
  } })
  return { owner, problem, directory, config }
}

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map(directory => fs.promises.rm(directory, { recursive: true, force: true })))
})

describe('immutable problem TestSet Revisions', () => {
  it('updates only an unfrozen activity and reports the pinned revision state', async () => {
    const { owner, problem, directory, config } = await fixture()
    const manager = await createTestUser({ organization: { role: 'teacher' } })
    const team = await createTestTeam({
      organizationId: null,
      ownerId: manager.user.id,
      ownerType: 'user',
      scope: 'personal',
    })
    const first = await ensureInitialTestSetRevision(problem.id, owner.user.id)
    await fs.promises.writeFile(path.join(directory, '1.in'), '7 8\n')
    const spec = await resolveConfigSpec(problem.id, config)
    const second = await publishTestSetRevision({
      problemId: problem.id,
      expectedLatestRevisionId: first!.id,
      source: 'admin_edit',
      createdBy: owner.user.id,
      baseConfigText: config,
      spec,
    })
    const training = await prisma.training.create({ data: {
      teamId: team.id,
      organizationId: null,
      scope: 'personal',
      title: 'Revision update fixture',
      format: 'icpc',
      type: 'training',
      startTime: new Date(Date.now() + 3600000),
      endTime: new Date(Date.now() + 7200000),
      status: 'upcoming',
      createdBy: manager.user.id,
    } })
    const trainingProblem = await prisma.trainingProblem.create({ data: {
      id: crypto.randomUUID(),
      trainingId: training.id,
      problemId: problem.id,
      alias: 'A',
      orderIndex: 0,
      testSetRevisionId: first!.id,
      judgeConfigSnapshot: first!.judgeConfig,
    } })

    const preview = await previewTrainingTestSetUpdate(training.id, trainingProblem.id, manager.user.id)
    expect(preview).toMatchObject({
      currentRevisionId: first!.id,
      latestRevisionId: second!.id,
      pending: true,
      frozen: false,
    })
    const updated = await updateTrainingTestSetRevision({
      trainingId: training.id,
      trainingProblemId: trainingProblem.id,
      userId: manager.user.id,
      revisionId: second!.id,
    })
    expect(updated).toMatchObject({ updated: true, currentRevisionId: second!.id })
    expect((await prisma.trainingProblem.findUniqueOrThrow({ where: { id: trainingProblem.id } })).testSetRevisionId).toBe(second!.id)

    const frozenTraining = await prisma.training.create({ data: {
      teamId: team.id,
      organizationId: null,
      scope: 'personal',
      title: 'Frozen revision fixture',
      format: 'icpc',
      type: 'training',
      startTime: new Date(Date.now() - 3600000),
      endTime: new Date(Date.now() + 3600000),
      status: 'ongoing',
      createdBy: manager.user.id,
    } })
    const frozenProblem = await prisma.trainingProblem.create({ data: {
      id: crypto.randomUUID(),
      trainingId: frozenTraining.id,
      problemId: problem.id,
      alias: 'A',
      orderIndex: 0,
      testSetRevisionId: first!.id,
      judgeConfigSnapshot: first!.judgeConfig,
    } })
    await expect(updateTrainingTestSetRevision({
      trainingId: frozenTraining.id,
      trainingProblemId: frozenProblem.id,
      userId: manager.user.id,
      revisionId: second!.id,
    })).rejects.toMatchObject({
      code: 'TEST_SET_REVISION_FROZEN',
      statusCode: 409,
    })
  })

  it('accepts checker metadata independently from ordinary testdata files', async () => {
    const { problem } = await fixture()
    const inspection = await inspectTestSetRevisionMigration()
    expect(inspection.valid.some(item => item.problemId === problem.id)).toBe(true)
    expect(inspection.invalid.some(item => item.problemId === problem.id)).toBe(false)
  })

  it('pins case and checker bytes while later revisions use replacements', async () => {
    const { owner, problem, directory, config } = await fixture()
    const first = await ensureInitialTestSetRevision(problem.id, owner.user.id)
    expect(first?.revisionNumber).toBe(1)
    const firstDirectory = path.join(directory, first!.testdataPath)
    expect(await fs.promises.readFile(path.join(firstDirectory, '1.in'), 'utf8')).toBe('1 2\n')
    expect(await fs.promises.readFile(path.join(firstDirectory, 'checker.cpp'), 'utf8')).toContain('checker v1')

    await fs.promises.writeFile(path.join(directory, '1.in'), '9 10\n')
    await fs.promises.writeFile(path.join(directory, 'checker.cpp'), '// checker v2\nint main(){}\n')
    const spec = await resolveConfigSpec(problem.id, config)
    const second = await publishTestSetRevision({
      problemId: problem.id,
      expectedLatestRevisionId: first!.id,
      source: 'admin_edit',
      createdBy: owner.user.id,
      baseConfigText: config,
      spec,
    })
    expect(second?.revisionNumber).toBe(2)
    expect(await fs.promises.readFile(path.join(firstDirectory, '1.in'), 'utf8')).toBe('1 2\n')
    expect(await fs.promises.readFile(path.join(firstDirectory, 'checker.cpp'), 'utf8')).toContain('checker v1')
    expect(await fs.promises.readFile(path.join(directory, second!.testdataPath, '1.in'), 'utf8')).toBe('9 10\n')
    expect(await fs.promises.readFile(path.join(directory, second!.testdataPath, 'checker.cpp'), 'utf8')).toContain('checker v2')
  })

  it('allows only one publisher for the same expected latest revision', async () => {
    const { owner, problem, config } = await fixture()
    const first = await ensureInitialTestSetRevision(problem.id, owner.user.id)
    const spec = await loadRevisionSpec(first!.id)
    const publish = () => publishTestSetRevision({
      problemId: problem.id,
      expectedLatestRevisionId: first!.id,
      source: 'admin_edit',
      createdBy: owner.user.id,
      baseConfigText: config,
      spec: spec!,
    })
    const results = await Promise.allSettled([publish(), publish()])
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    const rejection = results.find(item => item.status === 'rejected') as PromiseRejectedResult
    expect(rejection.reason).toBeInstanceOf(TestSetRevisionConflict)
    expect(await prisma.problemTestSetRevision.count({ where: { problemId: problem.id } })).toBe(2)
  })

  it('serializes 100 concurrent publishers without lost updates or orphan revision directories', async () => {
    const { owner, problem, config, directory } = await fixture()
    const first = await ensureInitialTestSetRevision(problem.id, owner.user.id)
    const spec = await loadRevisionSpec(first!.id)
    const publish = () => publishTestSetRevision({
      problemId: problem.id,
      expectedLatestRevisionId: first!.id,
      source: 'admin_edit',
      createdBy: owner.user.id,
      baseConfigText: config,
      spec: spec!,
    })

    const results = await Promise.allSettled(Array.from({ length: 100 }, publish))
    const fulfilled = results.filter(item => item.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof publish>>>[]
    const rejected = results.filter(item => item.status === 'rejected') as PromiseRejectedResult[]

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(99)
    expect(rejected.every(item => item.reason instanceof TestSetRevisionConflict)).toBe(true)
    expect(await prisma.problemTestSetRevision.count({ where: { problemId: problem.id } })).toBe(2)
    expect((await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).latestTestSetRevisionId).toBe(fulfilled[0].value!.id)

    const revisionEntries = await fs.promises.readdir(path.join(directory, 'revisions'))
    expect(revisionEntries.filter(name => name.endsWith('.pending'))).toHaveLength(0)
    expect(revisionEntries).toHaveLength(2)
  }, 120_000)

  it('lets 100 concurrent first users share the single initial revision', async () => {
    const { owner, problem, directory } = await fixture()
    const revisions = await Promise.all(Array.from({ length: 100 }, () =>
      ensureInitialTestSetRevision(problem.id, owner.user.id),
    ))

    expect(new Set(revisions.map(revision => revision?.id)).size).toBe(1)
    expect(await prisma.problemTestSetRevision.count({ where: { problemId: problem.id } })).toBe(1)
    expect((await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).latestTestSetRevisionId).toBe(revisions[0]!.id)

    const revisionEntries = await fs.promises.readdir(path.join(directory, 'revisions'))
    expect(revisionEntries.filter(name => name.endsWith('.pending'))).toHaveLength(0)
    expect(revisionEntries).toEqual([revisions[0]!.id])
  }, 120_000)

  it('does not publish another revision when the latest projection hash already exists', async () => {
    const { owner, problem, config } = await fixture()
    const first = await ensureInitialTestSetRevision(problem.id, owner.user.id)
    const spec = await loadRevisionSpec(first!.id)
    const second = await publishTestSetRevision({
      problemId: problem.id,
      expectedLatestRevisionId: first!.id,
      source: 'admin_edit',
      createdBy: owner.user.id,
      baseConfigText: config,
      spec: spec!,
    })
    expect(second!.judgeConfigHash).toBe(first!.judgeConfigHash)

    await migrateProblemTestSetRevisions(problem.id, owner.user.id)
    await migrateProblemTestSetRevisions(problem.id, owner.user.id)

    expect(await prisma.problemTestSetRevision.count({ where: { problemId: problem.id } })).toBe(2)
    expect((await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).latestTestSetRevisionId).toBe(second!.id)
  })

  it('creates an explicit mode-transition revision and disables Hack', async () => {
    const { owner, problem } = await fixture()
    const first = await ensureInitialTestSetRevision(problem.id, owner.user.id)
    await prisma.problemHackConfig.create({ data: {
      id: crypto.randomUUID(),
      problemId: problem.id,
      enabled: true,
      mode: 'acm',
      standardSource: 'int main(){}',
      validatorSource: 'int main(){}',
      updatedBy: owner.user.id,
    } })
    const second = await transitionJudgeMode({
      problemId: problem.id,
      targetMode: 'oi',
      expectedLatestRevisionId: first!.id,
      updatedBy: owner.user.id,
    })
    expect(second?.mode).toBe('oi')
    expect(second?.source).toBe('mode_transition')
    const graph = await loadRevisionSpec(second!.id)
    expect(graph?.subtasks?.[0]).toMatchObject({ id: 1, score: 100 })
    expect(graph?.subtasks?.[0].groups.map(group => group.kind)).toEqual(['official', 'hack_gate'])
    expect((await prisma.problemHackConfig.findUniqueOrThrow({ where: { problemId: problem.id } })).enabled).toBe(false)
    expect(await prisma.problemTestSetRevision.findUnique({ where: { id: first!.id } })).not.toBeNull()
  })

  it('normalizes legacy string subtask ids to stable numeric ids', async () => {
    const { problem } = await fixture()
    const spec = await resolveConfigSpec(problem.id, [
      'mode: oi',
      'subtasks:',
      '  - id: all',
      '    score: 100',
      '    scoring: sum',
      '    cases: [1]',
      '',
    ].join('\n'))

    expect(spec.subtasks).toHaveLength(1)
    expect(spec.subtasks?.[0]).toMatchObject({ id: 1, score: 100, if: [] })
    expect(spec.subtasks?.[0].groups[0]).toMatchObject({ key: 'official-1', type: 'sum' })
  })

  it('garbage-collects only old unreferenced content objects', async () => {
    const { problem, directory } = await fixture()
    const object = await ingestTestdataObject(problem.id, Buffer.from('orphan bytes\n'))
    await prisma.testdataObject.update({ where: { id: object.id }, data: { createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000) } })
    expect(fs.existsSync(path.join(directory, object.storageKey))).toBe(true)
    const result = await collectOrphanTestdataObjects({ olderThanMs: 24 * 60 * 60 * 1000 })
    expect(result.deleted).toBe(1)
    expect(await prisma.testdataObject.findUnique({ where: { id: object.id } })).toBeNull()
    expect(fs.existsSync(path.join(directory, object.storageKey))).toBe(false)
  })
})
