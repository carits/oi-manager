import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { finalizeHackResult, type HackJudgeResultPayload } from '../src/modules/problem/problem.hack.service'
import { ensureInitialTestSetRevision } from '../src/modules/problem/problem.testset-revision.service'
import { loadTestGraphWorkspace, replaceTestGraph } from '../src/modules/problem/problem.test-graph.service'
import { persistOwnedSubmissionResult } from '../src/ws/judge'
import {
  claimNextQueuedSubmission,
  createQueuedSubmissionWithRun,
} from '../src/modules/judge/application/judge-run.service'
import { createTestUser } from './helpers/testUser'

const root = path.join(process.cwd(), 'testdata')
const createdDirectories: string[] = []

async function fixture(mode: 'acm' | 'oi' = 'acm') {
  const owner = await createTestUser({ role: 'platform_admin' })
  const problemId = crypto.randomUUID()
  const directory = path.join(root, problemId)
  createdDirectories.push(directory)
  await fs.promises.mkdir(directory, { recursive: true })
  const input = Buffer.from('1 2\n')
  const output = Buffer.from('3\n')
  await Promise.all([
    fs.promises.writeFile(path.join(directory, '1.in'), input),
    fs.promises.writeFile(path.join(directory, '1.out'), output),
  ])
  const judgeConfig = JSON.stringify(mode === 'acm' ? {
    mode: 'acm', type: 'default', time: '1000ms', memory: '256MB',
    cases: [{ input: '1.in', output: '1.out' }],
  } : {
    mode: 'oi', type: 'default', time: '1000ms', memory: '256MB',
    subtasks: [{ id: 1, score: 100, if: [], groups: [
      { id: 'official-1', key: 'official-1', name: 'Official', kind: 'official', score: 100, type: 'sum', cases: [{ input: '1.in', output: '1.out', score: 100 }] },
      { id: 'hack-gate', key: 'hack-gate', name: 'Hack Gate', kind: 'hack_gate', score: 0, type: 'min', cases: [] },
    ] }],
  })
  await prisma.problem.create({ data: {
    id: problemId,
    platform: 'carits',
    problemId: `HACK-CONCURRENCY-${crypto.randomUUID()}`,
    title: 'Concurrent Hack fixture',
    ownerType: 'platform_admin',
    ownerId: owner.user.id,
    libraryScope: 'platform',
    libraryKey: 'platform',
    visibility: 'public',
    status: 'published',
    judgeConfig,
  } })
  const inputFileId = crypto.randomUUID(), outputFileId = crypto.randomUUID()
  await prisma.testdataFile.createMany({ data: [
    {
      id: inputFileId, problemId, filename: '1.in', size: input.length,
      md5: crypto.createHash('md5').update(input).digest('hex'),
      sha256: crypto.createHash('sha256').update(input).digest('hex'),
    },
    {
      id: outputFileId, problemId, filename: '1.out', size: output.length,
      md5: crypto.createHash('md5').update(output).digest('hex'),
      sha256: crypto.createHash('sha256').update(output).digest('hex'),
    },
  ] })
  const testcaseId = crypto.randomUUID()
  await prisma.problemTestcase.create({ data: {
    id: testcaseId, problemId, inputFileId, outputFileId, source: 'official', orderIndex: 0,
    inputSha256: crypto.createHash('sha256').update(input).digest('hex'),
    outputSha256: crypto.createHash('sha256').update(output).digest('hex'),
  } })
  const revision = await ensureInitialTestSetRevision(problemId, owner.user.id)
  const problem = await prisma.problem.findUniqueOrThrow({ where: { id: problemId } })
  await prisma.problemHackConfig.create({ data: {
    id: crypto.randomUUID(),
    problemId,
    enabled: true,
    mode,
    standardSource: 'int main(){}',
    validatorSource: 'int main(){}',
    classifierSource: mode === 'oi' ? 'int main(){}' : '',
    updatedBy: owner.user.id,
  } })
  return { owner, problem, revision: revision!, directory, testcaseId }
}

async function createAttempt(fixture: Awaited<ReturnType<typeof fixture>>) {
  return prisma.problemHackAttempt.create({ data: {
    id: crypto.randomUUID(),
    problemId: fixture.problem.id,
    userId: fixture.owner.user.id,
    status: 'judging',
    inputMode: 'data',
    inputData: 'candidate\n',
    hackSource: 'int main(){}',
    hackLanguage: 'cpp17',
    hackConfigRevision: 1,
    judgeConfigHash: fixture.revision.judgeConfigHash,
    testGraphRevision: fixture.problem.testGraphRevision,
    baseTestSetRevisionId: fixture.revision.id,
  } })
}

function acceptedPayload(id: string, inputData: string): HackJudgeResultPayload {
  return {
    hackAttemptId: id,
    outcome: 'accepted',
    baselineResult: 'Accepted',
    candidateResult: 'Wrong Answer',
    message: 'Accepted → Wrong Answer',
    inputData,
    outputData: '0\n',
  }
}

afterEach(async () => {
  await Promise.all(createdDirectories.splice(0).map(directory =>
    fs.promises.rm(directory, { recursive: true, force: true }),
  ))
})

describe('concurrent Hack promotion', () => {
  it('accepts exactly one of 100 duplicate cross-process-style submission results', async () => {
    const context = await fixture()
    const submission = await createQueuedSubmissionWithRun({
      userId: context.owner.user.id,
      oj: 'carits',
      problemId: context.problem.problemId,
      problemInternalId: context.problem.id,
      language: 'cpp',
      code: 'int main(){}',
      codeLength: 12,
      result: 'queuing',
      submitMethod: 'local',
      submitScope: 'problem',
      testSetRevisionId: context.revision.id,
      judgeConfigHash: context.revision.judgeConfigHash,
    })
    const claimed = await claimNextQueuedSubmission('judge-owner')
    expect(claimed?.submissionId).toBe(submission.id)
    const payload = {
      submissionId: submission.id,
      judgeRunId: claimed!.judgeRunId,
      judgeAttemptId: claimed!.judgeAttemptId,
      fencingToken: claimed!.fencingToken,
      result: 'Accepted',
      time: 5,
      wallTime: 7,
      memory: 1024,
      score: 100,
      cases: [],
    }

    const results = await Promise.all(Array.from({ length: 100 }, () =>
      persistOwnedSubmissionResult(payload, 'judge-owner'),
    ))
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await persistOwnedSubmissionResult({ ...payload, result: 'Wrong Answer', score: 0 }, 'stale-judge')).toBe(false)
    expect(await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).toMatchObject({
      result: 'accepted', score: 100, judgeId: null, judgeStarted: null,
    })
  }, 60_000)

  it('claims one duplicate Hack finalization and ignores the other 99', async () => {
    const context = await fixture()
    const attempt = await createAttempt(context)
    const payload = acceptedPayload(attempt.id, '73 19\n')

    await Promise.all(Array.from({ length: 100 }, () => finalizeHackResult(payload)))

    expect(await prisma.problemTestSetRevision.count({ where: { problemId: context.problem.id } })).toBe(2)
    expect(await prisma.problemTestcase.count({ where: { problemId: context.problem.id, source: 'hack' } })).toBe(1)
    expect(await prisma.testcaseCandidate.findUniqueOrThrow({ where: { hackAttemptId: attempt.id } })).toMatchObject({
      status: 'PROMOTED', promotedTestcaseId: expect.any(String), promotedRevisionId: expect.any(String),
    })
    expect(await prisma.problemHackAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({
      status: 'accepted', canonicalStatus: 'promoted',
    })
  }, 60_000)

  it('promotes one of ten simultaneous results and safely requeues every loser', async () => {
    const context = await fixture()
    const attempts = await Promise.all(Array.from({ length: 10 }, () => createAttempt(context)))

    await Promise.all(attempts.map((attempt, index) =>
      finalizeHackResult(acceptedPayload(attempt.id, `${index + 10} ${index + 20}\n`)),
    ))

    const rows = await prisma.problemHackAttempt.findMany({ where: { problemId: context.problem.id } })
    expect(rows.filter(row => row.status === 'accepted' && row.canonicalStatus === 'promoted')).toHaveLength(1)
    expect(rows.filter(row => row.status === 'queuing' && row.promotionRetries === 1)).toHaveLength(9)
    expect(await prisma.testcaseCandidate.count({ where: { problemId: context.problem.id, status: 'STALE' } })).toBe(9)
    expect(await prisma.problemTestSetRevision.count({ where: { problemId: context.problem.id } })).toBe(2)
    expect(await prisma.problemTestcase.count({ where: { problemId: context.problem.id, source: 'hack' } })).toBe(1)

    const files = await fs.promises.readdir(context.directory)
    expect(files.filter(name => name.endsWith('.pending'))).toHaveLength(0)
    expect(files.filter(name => /^hack_.+\.(?:in|out)$/.test(name))).toHaveLength(2)
  }, 60_000)

  it('turns the requeued duplicate into redundant without publishing another revision', async () => {
    const context = await fixture()
    const attempts = await Promise.all([createAttempt(context), createAttempt(context)])
    const payloads = attempts.map(attempt => acceptedPayload(attempt.id, '40 2\n'))

    await Promise.all(payloads.map(payload => finalizeHackResult(payload)))
    const queued = await prisma.problemHackAttempt.findFirstOrThrow({
      where: { problemId: context.problem.id, status: 'queuing' },
    })
    await prisma.problemHackAttempt.update({ where: { id: queued.id }, data: { status: 'judging' } })
    await finalizeHackResult(payloads.find(payload => payload.hackAttemptId === queued.id)!)

    const redundant = await prisma.problemHackAttempt.findUniqueOrThrow({ where: { id: queued.id } })
    expect(redundant).toMatchObject({ status: 'rejected', canonicalStatus: 'redundant', failureStage: 'input' })
    expect(await prisma.testcaseCandidate.findUniqueOrThrow({ where: { hackAttemptId: queued.id } })).toMatchObject({ status: 'REDUNDANT' })
    expect(await prisma.problemTestSetRevision.count({ where: { problemId: context.problem.id } })).toBe(2)
    expect(await prisma.problemTestcase.count({ where: { problemId: context.problem.id, source: 'hack' } })).toBe(1)
    const files = await fs.promises.readdir(context.directory)
    expect(files.filter(name => /^hack_.+\.(?:in|out)$/.test(name))).toHaveLength(2)
    expect(files.filter(name => name.endsWith('.pending'))).toHaveLength(0)
  }, 60_000)

  it('serializes an OI Test Graph save against Hack promotion without a partial revision', async () => {
    const context = await fixture('oi')
    const attempt = await createAttempt(context)
    const workspace = await loadTestGraphWorkspace(context.problem.id)
    expect(workspace?.migrated).toBe(true)
    const draft = {
      revision: workspace!.revision,
      expectedLatestRevisionId: context.revision.id,
      updatedBy: context.owner.user.id,
      subtasks: workspace!.subtasks.map(subtask => ({
        ...subtask,
        groups: subtask.groups.map(group => ({
          ...group,
          name: group.kind === 'official' ? `${group.name} edited` : group.name,
        })),
      })),
    }
    const payload = {
      ...acceptedPayload(attempt.id, '81 27\n'),
      baselineScore: 100,
      candidateScore: 0,
      affectedSubtaskIds: [1],
    }

    const [graphResult] = await Promise.all([
      replaceTestGraph(context.problem.id, draft),
      finalizeHackResult(payload),
    ])

    const revisions = await prisma.problemTestSetRevision.findMany({
      where: { problemId: context.problem.id }, orderBy: { revisionNumber: 'asc' },
    })
    expect(revisions).toHaveLength(2)
    const finalAttempt = await prisma.problemHackAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    if (graphResult.ok) {
      expect(revisions[1].source).toBe('admin_edit')
      expect(finalAttempt).toMatchObject({ status: 'queuing', promotionRetries: 1 })
      expect(await prisma.problemTestcase.count({ where: { problemId: context.problem.id, source: 'hack' } })).toBe(0)
    } else {
      expect(graphResult.code).toBe('TEST_GRAPH_STALE')
      expect(revisions[1].source).toBe('hack')
      expect(finalAttempt).toMatchObject({ status: 'accepted', canonicalStatus: 'promoted' })
      expect(await prisma.problemTestcase.count({ where: { problemId: context.problem.id, source: 'hack' } })).toBe(1)
    }
    const files = await fs.promises.readdir(context.directory)
    expect(files.filter(name => name.endsWith('.pending'))).toHaveLength(0)
  }, 60_000)
})
