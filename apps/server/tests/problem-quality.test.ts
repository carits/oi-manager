import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { getTestdataBlobStore, problemBlobKey } from '../src/modules/storage/blob-store'
import { ensureInitialTestSetRevision } from '../src/modules/problem/problem.testset-revision.service'
import {
  ProblemQualityError,
  claimQualityEvaluationJob,
  claimQualityVerificationJob,
  enqueueQualityEvaluationForRevision,
  finalizeQualityVerificationJob,
  getProblemQuality,
  processNextQualityEvaluationJob,
  runAutomatedProblemQualityAssessment,
  submitExpertProblemQualityReview,
} from '../src/modules/problem/problem.quality.service'
import { createTestApp, createAuthenticatedRequest } from './helpers/testRequest'
import { createTestUser } from './helpers/testUser'
import { generateTokenFromUser } from './helpers/testToken'

const app = createTestApp()
const testdataRoot = path.join(process.cwd(), 'testdata')
const createdProblemDirectories: string[] = []

type QualityFixtureOptions = {
  programs?: boolean
  feature?: boolean
  mode?: 'acm' | 'oi'
  customChecker?: boolean
}

async function completeQualityVerification(jobId: string) {
  await prisma.qualityEvaluationJob.update({
    where: { id: jobId },
    data: {
      verificationStatus: 'complete',
      verificationReport: {
        outcome: 'passed',
        standard: { passed: true, verdict: 'Accepted', score: 100 },
        validator: { passed: 1, failed: 0 },
        classifier: { passed: 1, failed: 0, required: false },
        checker: { passed: true },
        cases: [{ key: 'fixture', validatorPassed: true, classifierPassed: null }],
      },
    },
  })
}

async function activateProgram(problemId: string, createdBy: string, kind: 'standard' | 'validator' | 'classifier') {
  const programId = crypto.randomUUID()
  const versionId = crypto.randomUUID()
  const source = 'int main(){return 0;}'
  await prisma.problemJudgeProgram.create({ data: {
    id: programId,
    problemId,
    kind,
    name: kind,
    language: 'cpp17',
    currentVersionId: versionId,
    status: 'active',
    createdBy,
  } })
  await prisma.problemJudgeProgramVersion.create({ data: {
    id: versionId,
    programId,
    problemId,
    versionNumber: 1,
    language: 'cpp17',
    source,
    sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
    compileStatus: 'passed',
    lifecycleStatus: 'active',
    protocol: kind === 'standard' ? 'oj.standard/v1' : kind === 'classifier' ? 'oj.classifier/v1' : 'oj.validator/v1',
    activatedAt: new Date(),
    createdBy,
  } })
  return versionId
}

async function qualityFixture(options: QualityFixtureOptions = {}) {
  const mode = options.mode || 'acm'
  const manager = await createTestUser({ role: 'platform_admin' })
  const student = await createTestUser({ role: 'student' })
  const problemId = crypto.randomUUID()
  const problemDirectory = path.join(testdataRoot, problemId)
  createdProblemDirectories.push(problemDirectory)
  await fs.promises.mkdir(problemDirectory, { recursive: true })
  const input = Buffer.from('2\n1 2\n')
  const output = Buffer.from('3\n')
  await Promise.all([
    fs.promises.writeFile(path.join(problemDirectory, '1.in'), input),
    fs.promises.writeFile(path.join(problemDirectory, '1.out'), output),
    ...(options.customChecker ? [fs.promises.writeFile(path.join(problemDirectory, 'checker.cpp'), 'int main(){return 0;}\n')] : []),
  ])

  await prisma.problem.create({ data: {
    id: problemId,
    platform: 'carits',
    problemId: `QUALITY-${crypto.randomUUID()}`,
    title: '数组求和质量评估',
    description: '读取整数数组并输出其总和。',
    difficulty: 'introductory',
    timeLimit: 1000,
    memoryLimit: 256,
    ownerType: 'platform_admin',
    ownerId: manager.user.id,
    libraryScope: 'platform',
    libraryKey: 'platform',
    visibility: 'public',
    status: 'published',
    judgeConfig: JSON.stringify(mode === 'acm' ? {
      mode: 'acm', type: 'default', time: '1000ms', memory: '256MB',
      ...(options.customChecker ? { checker_type: 'testlib', checker: 'checker.cpp' } : {}),
      cases: [{ input: '1.in', output: '1.out' }],
    } : {
      mode: 'oi', type: 'default', time: '1000ms', memory: '256MB',
      ...(options.customChecker ? { checker_type: 'testlib', checker: 'checker.cpp' } : {}),
      subtasks: [{ id: 1, score: 100, if: [], groups: [
        { id: 'official-1', key: 'official-1', name: 'Official', kind: 'official', score: 100, type: 'sum', cases: [{ input: '1.in', output: '1.out', score: 100 }] },
        { id: 'hack-gate', key: 'hack-gate', name: 'Hack Gate', kind: 'hack_gate', score: 0, type: 'min', cases: [] },
      ] }],
    }),
  } })
  const inputFileId = crypto.randomUUID()
  const outputFileId = crypto.randomUUID()
  const inputSha256 = crypto.createHash('sha256').update(input).digest('hex')
  const outputSha256 = crypto.createHash('sha256').update(output).digest('hex')
  await prisma.testdataFile.createMany({ data: [
    { id: inputFileId, problemId, filename: '1.in', size: input.length, sha256: inputSha256 },
    { id: outputFileId, problemId, filename: '1.out', size: output.length, sha256: outputSha256 },
  ] })
  const testcaseId = crypto.randomUUID()
  await prisma.problemTestcase.create({ data: {
    id: testcaseId,
    problemId,
    inputFileId,
    outputFileId,
    source: 'official',
    orderIndex: 0,
    inputSha256,
    outputSha256,
  } })
  const revision = await ensureInitialTestSetRevision(problemId, manager.user.id)
  if (!revision) throw new Error('fixture failed to create initial Revision')

  if (options.programs !== false) {
    await activateProgram(problemId, manager.user.id, 'standard')
    await activateProgram(problemId, manager.user.id, 'validator')
    if (mode === 'oi') await activateProgram(problemId, manager.user.id, 'classifier')
  }
  if (options.feature !== false) {
    await prisma.problemFeatureDefinition.create({ data: {
      id: crypto.randomUUID(),
      problemId,
      key: 'n_min',
      name: '最小规模',
      kind: 'boundary',
      config: { importance: 'critical' },
      orderIndex: 0,
    } })
  }

  const corpusId = crypto.randomUUID()
  const evaluationClusterId = crypto.randomUUID()
  const holdoutClusterId = crypto.randomUUID()
  await prisma.wrongCorpusRevision.create({ data: {
    id: corpusId,
    problemId,
    revisionNumber: 1,
    status: 'active',
    sampleCount: 5,
    clusterCount: 2,
    evaluationCount: 1,
    holdoutCount: 1,
    corpusHash: crypto.createHash('sha256').update('quality-corpus-v1').digest('hex'),
    createdBy: manager.user.id,
    activatedAt: new Date(),
  } })
  await prisma.wrongBehaviorCluster.createMany({ data: [
    {
      id: evaluationClusterId,
      problemId,
      corpusRevisionId: corpusId,
      representativeSampleId: crypto.randomUUID(),
      behaviorHash: crypto.createHash('sha256').update('evaluation').digest('hex'),
      weight: 2,
      frequency: 3,
      partition: 'evaluation',
      status: 'active',
    },
    {
      id: holdoutClusterId,
      problemId,
      corpusRevisionId: corpusId,
      representativeSampleId: crypto.randomUUID(),
      behaviorHash: crypto.createHash('sha256').update('holdout').digest('hex'),
      weight: 3,
      frequency: 2,
      partition: 'holdout',
      status: 'active',
    },
  ] })
  await prisma.testcaseCandidate.create({ data: {
    id: crypto.randomUUID(),
    problemId,
    source: 'admin_import',
    targetRole: 'official',
    status: 'PROMOTED',
    evaluationStage: 'completed',
    baseTestSetRevisionId: revision.id,
    inputSha256,
    outputSha256,
    inputSize: input.length,
    outputSize: output.length,
    inputFileName: '1.in',
    outputFileName: '1.out',
    corpusRevisionId: corpusId,
    featureFingerprint: JSON.stringify(['n_min']),
    semanticFingerprint: 'n_min',
    createdBy: manager.user.id,
    promotedTestcaseId: testcaseId,
    promotedRevisionId: revision.id,
    promotedAt: new Date(),
    selectionOutcome: {
      evaluation: {
        clusters: [{ clusterId: evaluationClusterId, killedCaseKeys: ['candidate'] }],
      },
    },
  } })
  await prisma.problemStatement.create({ data: {
    id: crypto.randomUUID(),
    problemId,
    type: 'statement',
    format: 'markdown',
    language: 'zh-CN',
    content: '# 数组求和\n\n## 输入\n第一行一个整数 $1 <= n <= 100000$，第二行给出 n 个整数。\n\n## 输出\n输出总和。\n\n## 样例\n```\n2\n1 2\n```',
    isVisible: true,
  } })

  return { manager, student, problemId, problemDirectory, revision, corpusId, testcaseId, evaluationClusterId, holdoutClusterId }
}

beforeAll(async () => {
  // Isolated feature tests materialize Prisma with `db push`, which cannot
  // install database triggers. Install the same guards declared by the
  // production migration so pinned inputs and immutable evidence are exercised.
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION prevent_quality_job_input_mutation()
    RETURNS trigger AS $$
    BEGIN
      IF NEW."problemId" IS DISTINCT FROM OLD."problemId"
        OR NEW."revisionId" IS DISTINCT FROM OLD."revisionId"
        OR NEW."corpusRevisionId" IS DISTINCT FROM OLD."corpusRevisionId"
        OR NEW."qualityRuleVersion" IS DISTINCT FROM OLD."qualityRuleVersion"
        OR NEW."ruleConfig" IS DISTINCT FROM OLD."ruleConfig"
        OR NEW."inputSnapshot" IS DISTINCT FROM OLD."inputSnapshot"
        OR NEW."inputHash" IS DISTINCT FROM OLD."inputHash"
        OR NEW."featureSchemaHash" IS DISTINCT FROM OLD."featureSchemaHash"
        OR NEW."solutionProfileSchemaHash" IS DISTINCT FROM OLD."solutionProfileSchemaHash"
        OR NEW."standardVersionId" IS DISTINCT FROM OLD."standardVersionId"
        OR NEW."validatorVersionId" IS DISTINCT FROM OLD."validatorVersionId"
        OR NEW."classifierVersionId" IS DISTINCT FROM OLD."classifierVersionId"
        OR NEW."checkerHash" IS DISTINCT FROM OLD."checkerHash"
        OR NEW."judgeConfigHash" IS DISTINCT FROM OLD."judgeConfigHash"
        OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy"
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
        OR NEW."queuedAt" IS DISTINCT FROM OLD."queuedAt"
      THEN
        RAISE EXCEPTION 'QualityEvaluationJob pinned inputs are immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS "QualityEvaluationJob_immutable_inputs" ON "QualityEvaluationJob";
    CREATE TRIGGER "QualityEvaluationJob_immutable_inputs"
    BEFORE UPDATE ON "QualityEvaluationJob"
    FOR EACH ROW EXECUTE FUNCTION prevent_quality_job_input_mutation();

    CREATE OR REPLACE FUNCTION prevent_problem_quality_automatic_mutation()
    RETURNS trigger AS $$
    BEGIN
      IF OLD."status" = 'EXPERT_REVIEWED' THEN
        RAISE EXCEPTION 'ProblemQualityAssessment expert conclusion is immutable';
      END IF;
      IF NEW."problemId" IS DISTINCT FROM OLD."problemId"
        OR NEW."ruleVersion" IS DISTINCT FROM OLD."ruleVersion"
        OR NEW."subjectVersionHash" IS DISTINCT FROM OLD."subjectVersionHash"
        OR NEW."statementScore" IS DISTINCT FROM OLD."statementScore"
        OR NEW."solutionCorrectnessScore" IS DISTINCT FROM OLD."solutionCorrectnessScore"
        OR NEW."difficultyDesignScore" IS DISTINCT FROM OLD."difficultyDesignScore"
        OR NEW."constraintDesignScore" IS DISTINCT FROM OLD."constraintDesignScore"
        OR NEW."subtaskDesignScore" IS DISTINCT FROM OLD."subtaskDesignScore"
        OR NEW."automatedScore" IS DISTINCT FROM OLD."automatedScore"
        OR NEW."confidenceScore" IS DISTINCT FROM OLD."confidenceScore"
        OR NEW."confidenceLevel" IS DISTINCT FROM OLD."confidenceLevel"
        OR NEW."automatedEvidence" IS DISTINCT FROM OLD."automatedEvidence"
        OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy"
        OR NEW."evaluatedAt" IS DISTINCT FROM OLD."evaluatedAt"
        OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
      THEN
        RAISE EXCEPTION 'ProblemQualityAssessment automated evidence is immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS "ProblemQualityAssessment_immutable_automatic_evidence" ON "ProblemQualityAssessment";
    CREATE TRIGGER "ProblemQualityAssessment_immutable_automatic_evidence"
    BEFORE UPDATE ON "ProblemQualityAssessment"
    FOR EACH ROW EXECUTE FUNCTION prevent_problem_quality_automatic_mutation();

    CREATE OR REPLACE FUNCTION prevent_quality_snapshot_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'TestSetQualitySnapshot is immutable';
    END;
    $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS "TestSetQualitySnapshot_immutable_update" ON "TestSetQualitySnapshot";
    CREATE TRIGGER "TestSetQualitySnapshot_immutable_update"
    BEFORE UPDATE ON "TestSetQualitySnapshot"
    FOR EACH ROW EXECUTE FUNCTION prevent_quality_snapshot_mutation();
    DROP TRIGGER IF EXISTS "TestSetQualitySnapshot_immutable_delete" ON "TestSetQualitySnapshot";
    CREATE TRIGGER "TestSetQualitySnapshot_immutable_delete"
    BEFORE DELETE ON "TestSetQualitySnapshot"
    FOR EACH ROW EXECUTE FUNCTION prevent_quality_snapshot_mutation();
  `)
})

afterEach(async () => {
  await Promise.all(createdProblemDirectories.splice(0).map(directory =>
    fs.promises.rm(directory, { recursive: true, force: true }),
  ))
})

describe('TestSet quality evaluation', () => {
  it('pins inputs, evaluates Evaluation and Holdout separately, and enqueues idempotently', async () => {
    const context = await qualityFixture()
    const first = await enqueueQualityEvaluationForRevision({
      problemId: context.problemId,
      revisionId: context.revision.id,
      corpusRevisionId: context.corpusId,
      createdBy: context.manager.user.id,
    })
    const duplicate = await enqueueQualityEvaluationForRevision({
      problemId: context.problemId,
      revisionId: context.revision.id,
      corpusRevisionId: context.corpusId,
      createdBy: context.manager.user.id,
    })
    expect(duplicate.jobId).toBe(first.jobId)

    await expect(prisma.qualityEvaluationJob.update({
      where: { id: first.jobId },
      data: { inputHash: crypto.createHash('sha256').update('tampered').digest('hex') },
    })).rejects.toThrow(/pinned inputs are immutable/i)

    // The worker must use the job's immutable input snapshot, not mutable
    // cluster rows observed later.
    await prisma.wrongBehaviorCluster.update({
      where: { id: context.evaluationClusterId },
      data: { partition: 'holdout', weight: 99 },
    })
    expect(await processNextQualityEvaluationJob('must-wait-for-semantic-verification')).toEqual({ processed: 0, succeeded: 0, failed: 0 })
    const verificationTask = await claimQualityVerificationJob('semantic-judge')
    expect(verificationTask).toMatchObject({ taskType: 'quality_evaluation_verification', jobId: first.jobId, cases: [expect.objectContaining({ input: '1.in', output: '1.out' })] })
    expect(await finalizeQualityVerificationJob('semantic-judge', {
      jobId: first.jobId,
      fencingToken: verificationTask!.fencingToken,
      report: {
        outcome: 'passed',
        standard: { passed: true, verdict: 'Accepted', score: 100 },
        validator: { passed: 1, failed: 0 },
        classifier: { passed: 0, failed: 0, required: false },
        checker: { passed: true },
        cases: [{ key: verificationTask!.cases[0].key, validatorPassed: true, classifierPassed: null }],
      },
    })).toBe(true)
    expect(await processNextQualityEvaluationJob('quality-test-worker')).toEqual({ processed: 1, succeeded: 1, failed: 0 })
    const snapshot = await prisma.testSetQualitySnapshot.findUniqueOrThrow({ where: { evaluationJobId: first.jobId } })
    expect(snapshot).toMatchObject({
      qualityStatus: 'READY',
      overallScore: expect.any(Number),
      evaluationClusterCount: 1,
      holdoutClusterCount: 1,
      evaluationCoverage: 1,
      holdoutCoverage: 0,
      weightedKillCoverage: 0.4,
    })
    expect((snapshot.evidence as any).pinnedInputs).toMatchObject({
      revisionId: context.revision.id,
      corpusRevisionId: context.corpusId,
      qualityRuleVersion: 'QUALITY_RULE_V1',
      asOfDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
    await expect(prisma.testSetQualitySnapshot.update({ where: { id: snapshot.id }, data: { overallScore: 100 } })).rejects.toThrow(/immutable/i)
    await expect(prisma.testSetQualitySnapshot.delete({ where: { id: snapshot.id } })).rejects.toThrow(/immutable/i)
  })

  it('applies the Critical Gate when a pinned Revision object disappears', async () => {
    const context = await qualityFixture()
    const queued = await enqueueQualityEvaluationForRevision({
      problemId: context.problemId,
      revisionId: context.revision.id,
      corpusRevisionId: context.corpusId,
      createdBy: context.manager.user.id,
    })
    const job = await prisma.qualityEvaluationJob.findUniqueOrThrow({ where: { id: queued.jobId } })
    const object = (job.inputSnapshot as any).objects[0]
    await getTestdataBlobStore().delete(problemBlobKey(context.problemId, object.storageKey))

    await completeQualityVerification(queued.jobId)
    await processNextQualityEvaluationJob('quality-critical-worker')
    const snapshot = await prisma.testSetQualitySnapshot.findUniqueOrThrow({ where: { evaluationJobId: queued.jobId } })
    expect(snapshot.qualityStatus).toBe('CRITICAL')
    expect(snapshot.overallScore).toBeNull()
    expect(snapshot.criticalIssueCount).toBeGreaterThan(0)
    expect((snapshot.evidence as any).criticalIssues).toContainEqual(expect.objectContaining({ code: 'TESTDATA_OBJECT_MISSING' }))
  })

  it('pins a custom Checker asset and treats later Revision-file tampering as Critical', async () => {
    const context = await qualityFixture({ customChecker: true })
    const queued = await enqueueQualityEvaluationForRevision({
      problemId: context.problemId,
      revisionId: context.revision.id,
      corpusRevisionId: context.corpusId,
      createdBy: context.manager.user.id,
    })
    const job = await prisma.qualityEvaluationJob.findUniqueOrThrow({ where: { id: queued.jobId } })
    expect((job.inputSnapshot as any).checker).toMatchObject({
      kind: 'testlib',
      configured: true,
      asset: { fileName: 'checker.cpp', sha256: expect.any(String) },
    })
    await fs.promises.writeFile(path.join(context.problemDirectory, context.revision.testdataPath, 'checker.cpp'), 'tampered\n')
    await completeQualityVerification(queued.jobId)
    await processNextQualityEvaluationJob('quality-checker-integrity-worker')
    const snapshot = await prisma.testSetQualitySnapshot.findUniqueOrThrow({ where: { evaluationJobId: queued.jobId } })
    expect(snapshot).toMatchObject({ qualityStatus: 'CRITICAL', overallScore: null })
    expect((snapshot.evidence as any).criticalIssues).toContainEqual(expect.objectContaining({ code: 'CHECKER_ASSET_HASH_MISMATCH' }))
  })

  it('marks the old certificate stale and produces a non-compensable Critical result for a confirmed incident', async () => {
    const context = await qualityFixture()
    const first = await enqueueQualityEvaluationForRevision({
      problemId: context.problemId,
      revisionId: context.revision.id,
      corpusRevisionId: context.corpusId,
      createdBy: context.manager.user.id,
    })
    await completeQualityVerification(first.jobId)
    await processNextQualityEvaluationJob('quality-ready-before-incident')
    const ready = await prisma.testSetQualitySnapshot.findUniqueOrThrow({ where: { evaluationJobId: first.jobId } })
    expect(ready).toMatchObject({ qualityStatus: 'READY', overallScore: expect.any(Number), criticalIssueCount: 0 })

    await prisma.testSetQualityIncident.create({ data: {
      id: crypto.randomUUID(),
      problemId: context.problemId,
      revisionId: context.revision.id,
      severity: 'CRITICAL',
      type: 'WRONG_OFFICIAL_ANSWER',
      description: '标准答案在边界输入上与独立小规模穷举不一致。',
      evidence: { reportHash: crypto.createHash('sha256').update('critical-evidence').digest('hex') },
      status: 'CONFIRMED',
      discoveredByUserId: context.manager.user.id,
      confirmedByUserId: context.manager.user.id,
      confirmedAt: new Date(),
    } })

    const oldView = await getProblemQuality({
      userId: context.manager.user.id,
      username: context.manager.user.username,
      role: 'platform_admin',
    }, context.problemId)
    expect(oldView.testSetQuality).toMatchObject({ id: ready.id, qualityStatus: 'READY', isStale: true })
    expect((oldView.testSetQuality as any).reasons).toContain('CRITICAL_INCIDENT_REPORTED')

    const criticalJob = await enqueueQualityEvaluationForRevision({
      problemId: context.problemId,
      revisionId: context.revision.id,
      corpusRevisionId: context.corpusId,
      createdBy: context.manager.user.id,
    })
    expect(criticalJob.jobId).not.toBe(first.jobId)
    await completeQualityVerification(criticalJob.jobId)
    await processNextQualityEvaluationJob('quality-critical-incident-worker')
    const critical = await prisma.testSetQualitySnapshot.findUniqueOrThrow({ where: { evaluationJobId: criticalJob.jobId } })
    expect(critical).toMatchObject({ qualityStatus: 'CRITICAL', overallScore: null, criticalIssueCount: 1 })
    expect((critical.evidence as any).scoring.provisionalOverall).toEqual(expect.any(Number))
  })

  it('claims one worker, then recovers an expired lease with a new fencing token', async () => {
    const context = await qualityFixture()
    const queued = await enqueueQualityEvaluationForRevision({ problemId: context.problemId, revisionId: context.revision.id, createdBy: context.manager.user.id })
    await completeQualityVerification(queued.jobId)
    const claims = await Promise.all(Array.from({ length: 8 }, (_, index) => claimQualityEvaluationJob(`worker-${index}`)))
    const first = claims.find(Boolean)
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(first?.fencingToken).toBeTruthy()
    await prisma.qualityEvaluationJob.update({ where: { id: first!.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } })
    const recovered = await claimQualityEvaluationJob('recovery-worker')
    expect(recovered).toMatchObject({ id: first!.id, leaseOwner: 'recovery-worker', attempts: 2 })
    expect(recovered?.fencingToken).not.toBe(first?.fencingToken)
  })

  it('never exposes private evidence, actor IDs or job inputs in public quality DTOs', async () => {
    const context = await qualityFixture()
    const managerClient = createAuthenticatedRequest(app, generateTokenFromUser(context.manager.user))
    const studentClient = createAuthenticatedRequest(app, generateTokenFromUser({ ...context.student.user, workspaceMode: 'personal' }))
    const queued = await managerClient.post(`/api/problems/${context.problemId}/quality-evaluation-jobs`).send({ revisionId: context.revision.id })
    expect(queued.status, JSON.stringify(queued.body)).toBe(202)
    await completeQualityVerification(queued.body.data.jobId)
    await processNextQualityEvaluationJob('quality-http-worker')
    await runAutomatedProblemQualityAssessment({
      userId: context.manager.user.id,
      username: context.manager.user.username,
      role: 'platform_admin',
    }, context.problemId)

    const publicResponse = await studentClient.get(`/api/problems/${context.problemId}/quality`)
    expect(publicResponse.status, JSON.stringify(publicResponse.body)).toBe(200)
    expect(publicResponse.body.data).not.toHaveProperty('jobs')
    expect(publicResponse.body.data.testSetQuality).not.toHaveProperty('evidence')
    expect(publicResponse.body.data.testSetQuality).not.toHaveProperty('inputHash')
    expect(publicResponse.body.data.testSetQuality).not.toHaveProperty('evaluationJobId')
    expect(publicResponse.body.data.testSetQuality).not.toHaveProperty('holdoutCoverage')
    expect(publicResponse.body.data.testSetQuality).not.toHaveProperty('holdoutClusterCount')
    expect(publicResponse.body.data.testSetQuality).not.toHaveProperty('wrongProgramCount')
    expect(publicResponse.body.data.testSetQuality).not.toHaveProperty('featureCoverage')
    expect(publicResponse.body.data.testSetQuality).not.toHaveProperty('reasons')
    expect(publicResponse.body.data.problemQuality).not.toHaveProperty('automatedEvidence')
    expect(publicResponse.body.data.problemQuality).not.toHaveProperty('expertEvidence')
    expect(publicResponse.body.data.problemQuality).not.toHaveProperty('createdBy')
    expect(publicResponse.body.data.problemQuality).not.toHaveProperty('reviewedBy')
    expect(publicResponse.body.data.problemQuality).not.toHaveProperty('subjectVersionHash')

    const managerResponse = await managerClient.get(`/api/problems/${context.problemId}/quality`)
    expect(managerResponse.body.data.jobs[0]).not.toHaveProperty('inputSnapshot')
    expect(managerResponse.body.data.testSetQuality.evidence.pinnedInputs).toBeTruthy()
    const jobDetail = await managerClient.get(`/api/problems/${context.problemId}/quality-evaluation-jobs/${queued.body.data.jobId}`)
    expect(jobDetail.body.data.inputSnapshot).toBeTruthy()
  })
})

describe('Problem quality automated and expert assessment', () => {
  it('keeps automated evidence immutable while restricting expert scoring to platform roles', async () => {
    const context = await qualityFixture()
    const managerPayload = {
      userId: context.manager.user.id,
      username: context.manager.user.username,
      role: 'platform_admin' as const,
    }
    const studentPayload = {
      userId: context.student.user.id,
      username: context.student.user.username,
      role: 'student' as const,
      workspaceMode: 'personal' as const,
    }
    const automated = await runAutomatedProblemQualityAssessment(managerPayload, context.problemId)
    const repeated = await runAutomatedProblemQualityAssessment(managerPayload, context.problemId)
    expect(repeated.id).toBe(automated.id)
    expect(automated).toMatchObject({ status: 'AUTOMATED_READY', automatedScore: expect.any(Number), expertScore: null, overallScore: null })

    await expect(submitExpertProblemQualityReview(studentPayload, context.problemId, automated.id, {
      algorithmicValueScore: 18,
      editorialScore: 4,
      originalityScore: 4,
      comment: '这是一份足够长但无权限提交的专家审核意见。',
    })).rejects.toMatchObject<Partial<ProblemQualityError>>({ statusCode: 403, code: 'PLATFORM_QUALITY_EXPERT_REQUIRED' })

    const beforeEvidence = JSON.stringify(automated.automatedEvidence)
    await expect(prisma.problemQualityAssessment.update({
      where: { id: automated.id },
      data: { automatedEvidence: { replaced: true } },
    })).rejects.toThrow(/automated evidence is immutable/i)
    const reviewed = await submitExpertProblemQualityReview(managerPayload, context.problemId, automated.id, {
      algorithmicValueScore: 18,
      editorialScore: 4,
      originalityScore: 4,
      comment: '题目考查目标清晰，证明结构完整，数据约束与算法复杂度能够相互印证。',
      checklist: { provenanceChecked: true, proofChecked: true },
    })
    expect(reviewed).toMatchObject({
      status: 'EXPERT_REVIEWED',
      expertScore: 26,
      overallScore: automated.automatedScore + 26,
      reviewedBy: context.manager.user.id,
    })
    expect(JSON.stringify(reviewed.automatedEvidence)).toBe(beforeEvidence)
    await expect(prisma.problemQualityAssessment.update({
      where: { id: automated.id },
      data: { expertEvidence: { replaced: true } },
    })).rejects.toThrow(/expert conclusion is immutable/i)
    await expect(submitExpertProblemQualityReview(managerPayload, context.problemId, automated.id, {
      algorithmicValueScore: 19,
      editorialScore: 5,
      originalityScore: 5,
      comment: '第二次审核不得覆盖第一次审核形成的不可变专家结论。',
    })).rejects.toMatchObject<Partial<ProblemQualityError>>({ statusCode: 409, code: 'PROBLEM_QUALITY_ALREADY_REVIEWED' })
  })

  it('manages versioned Solution Profiles from fixed local submissions and requeues quality evidence', async () => {
    const context = await qualityFixture({ mode: 'oi' })
    const submission = await prisma.submission.create({ data: {
      userId: context.student.user.id,
      oj: 'carits',
      problemId: 'QUALITY-REFERENCE',
      language: 'cpp17',
      code: 'int main(){return 0;}',
      codeLength: 21,
      result: 'Partial Accepted',
      score: 40,
      subtasks: JSON.stringify([{ id: 1, score: 40 }]),
      submitMethod: 'local',
      submitScope: 'problem',
      workspaceScope: 'personal',
      problemInternalId: context.problemId,
      testSetRevisionId: context.revision.id,
    } })
    const managerClient = createAuthenticatedRequest(app, generateTokenFromUser(context.manager.user))
    const studentClient = createAuthenticatedRequest(app, generateTokenFromUser({ ...context.student.user, workspaceMode: 'personal' }))
    const body = {
      key: 'official-reference',
      name: '官方正确解',
      expectedClass: 'correct',
      expectedComplexity: 'O(n)',
      expectedScoreMin: 30,
      expectedScoreMax: 50,
      expectedSubtaskScores: [{ subtaskId: 1, min: 35, max: 45 }],
      submissionId: submission.id,
    }

    const forbidden = await studentClient.post(`/api/problems/${context.problemId}/solution-profiles`).send(body)
    expect(forbidden.status).toBe(404)
    const created = await managerClient.post(`/api/problems/${context.problemId}/solution-profiles`).send(body)
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.data).toMatchObject({ key: 'official-reference', revision: 1, status: 'active', observed: { revisionId: context.revision.id, score: 40 } })

    const profiles = await managerClient.get(`/api/problems/${context.problemId}/solution-profiles`)
    expect(profiles.status).toBe(200)
    expect(profiles.body.data).toHaveLength(1)
    const queued = await prisma.qualityEvaluationJob.findMany({ where: { problemId: context.problemId } })
    expect(queued).toHaveLength(1)
    expect((queued[0].inputSnapshot as any).solutionProfiles).toEqual([
      expect.objectContaining({ id: created.body.data.id, definitionRevision: 1, source: expect.objectContaining({ submissionId: submission.id }) }),
    ])
    await completeQualityVerification(queued[0].id)
    expect(await processNextQualityEvaluationJob('quality-solution-profile-worker')).toEqual({ processed: 1, succeeded: 1, failed: 0 })
    const snapshot = await prisma.testSetQualitySnapshot.findUniqueOrThrow({ where: { evaluationJobId: queued[0].id } })
    expect(snapshot.subtaskQualityScore).toBe(10)
    expect((snapshot.evidence as any).scoring).toMatchObject({ solutionProfileAlignment: 1, evaluatedSolutionProfileCount: 1, solutionProfileCount: 1 })

    const stale = await managerClient.patch(`/api/problems/${context.problemId}/solution-profiles/${created.body.data.id}`).send({ ...body, expectedRevision: 99, status: 'retired' })
    expect(stale.status).toBe(409)
    const retired = await managerClient.patch(`/api/problems/${context.problemId}/solution-profiles/${created.body.data.id}`).send({ ...body, expectedRevision: 1, status: 'retired' })
    expect(retired.status, JSON.stringify(retired.body)).toBe(200)
    expect(retired.body.data).toMatchObject({ revision: 2, status: 'retired' })
  })
})
