import crypto from 'node:crypto'
import type { Prisma, TestcaseCandidateStatus } from '@prisma/client'
import { prisma } from '../../prisma'
import { ingestTestdataObject } from './problem.testset-revision.service'
import { EVALUATION_LIMITS, EvaluationBudgetError } from './problem.evaluation-budget.service'
import { putReferencedBlob } from '../storage/content-blob.service'

function digest(content: Buffer) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

export const ACTIVE_CANDIDATE_STATUSES: TestcaseCandidateStatus[] = [
  'UPLOADED', 'ADMITTED', 'VALIDATING', 'EVALUATING_L1', 'EVALUATING_L2', 'EVALUATING_HOLDOUT', 'ELIGIBLE', 'SELECTED', 'VALIDATED', 'PROMOTING',
]

export async function assertCandidatePoolCapacity(problemId: string, additionalBytes: number) {
  const [count, size] = await Promise.all([
    prisma.testcaseCandidate.count({ where: { problemId, status: { in: ACTIVE_CANDIDATE_STATUSES } } }),
    prisma.testcaseCandidate.aggregate({ where: { problemId, status: { in: ACTIVE_CANDIDATE_STATUSES } }, _sum: { inputSize: true, outputSize: true } }),
  ])
  const bytes = Number(size._sum.inputSize || 0) + Number(size._sum.outputSize || 0)
  if (count >= EVALUATION_LIMITS.maxHotCandidates || bytes + additionalBytes > EVALUATION_LIMITS.maxHotBytes) {
    throw new EvaluationBudgetError(429, 'CANDIDATE_POOL_CAPACITY_EXCEEDED', '该题候选池已达到硬上限，请等待低价值候选淘汰')
  }
}

export async function createAdmittedCandidate(params: {
  id?: string
  problemId: string
  createdBy: string
  source: 'direct_data' | 'generator' | 'hack' | 'admin_import'
  targetRole: 'official' | 'hack_gate'
  baseTestSetRevisionId?: string | null
  input: Buffer
  output: Buffer
  inputFileName: string
  outputFileName: string
  affectedSubtaskIds?: number[]
  standardVersionId?: string | null
  validatorVersionId?: string | null
  classifierVersionId?: string | null
  generatorVersionId?: string | null
  provenance?: unknown
  hackAttemptId?: string | null
  status?: 'ADMITTED' | 'ELIGIBLE'
  evaluationStage?: string
}) {
  if (!params.input.length || !params.output.length || params.input.length > EVALUATION_LIMITS.maxCandidateBytes || params.output.length > EVALUATION_LIMITS.maxCandidateBytes) {
    throw new EvaluationBudgetError(413, 'CANDIDATE_DATA_TOO_LARGE', '候选输入或答案为空，或超过 16 MiB')
  }
  await assertCandidatePoolCapacity(params.problemId, params.input.length + params.output.length)
  const inputSha256 = digest(params.input), outputSha256 = digest(params.output)
  const duplicate = await prisma.testcaseCandidate.findFirst({ where: { problemId: params.problemId, inputSha256, status: { in: ACTIVE_CANDIDATE_STATUSES } } })
  if (duplicate) return { candidate: duplicate, duplicate: true }
  const latest = await prisma.problem.findUnique({ where: { id: params.problemId }, select: { latestTestSetRevisionId: true } })
  const canonicalDuplicate = latest?.latestTestSetRevisionId ? await prisma.testdataObject.findFirst({
    where: {
      problemId: params.problemId,
      sha256: inputSha256,
      OR: [
        { AcmInputs: { some: { revisionId: latest.latestTestSetRevisionId } } },
        { GroupInputs: { some: { revisionId: latest.latestTestSetRevisionId } } },
      ],
    },
  }) : null
  if (canonicalDuplicate) throw new EvaluationBudgetError(409, 'CANDIDATE_CANONICAL_DUPLICATE', '候选输入已存在于正式测试版本')
  const [inputObject, outputObject] = await Promise.all([ingestTestdataObject(params.problemId, params.input), ingestTestdataObject(params.problemId, params.output)])
  const candidate = await prisma.testcaseCandidate.create({ data: {
    id: params.id || crypto.randomUUID(), problemId: params.problemId, hackAttemptId: params.hackAttemptId || null,
    source: params.source, targetRole: params.targetRole, status: params.status || 'ADMITTED', evaluationStage: params.evaluationStage || 'awaiting_evaluator',
    baseTestSetRevisionId: params.baseTestSetRevisionId || null, inputObjectId: inputObject.id, outputObjectId: outputObject.id,
    inputSha256, outputSha256, inputSize: params.input.length, outputSize: params.output.length,
    inputFileName: params.inputFileName, outputFileName: params.outputFileName,
    affectedSubtaskIds: params.affectedSubtaskIds?.length ? JSON.stringify(params.affectedSubtaskIds) : null,
    standardVersionId: params.standardVersionId || null, validatorVersionId: params.validatorVersionId || null,
    classifierVersionId: params.classifierVersionId || null, generatorVersionId: params.generatorVersionId || null, provenance: params.provenance as any,
    semanticFingerprint: digest(Buffer.from(`${inputSha256}\0${outputSha256}`)), createdBy: params.createdBy,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
  } })
  await Promise.all([
    putReferencedBlob({ content: params.input, ownerType: 'testcase_candidate', ownerId: candidate.id, role: 'input', contentType: 'application/octet-stream' }),
    putReferencedBlob({ content: params.output, ownerType: 'testcase_candidate', ownerId: candidate.id, role: 'answer', contentType: 'application/octet-stream' }),
  ])
  return { candidate, duplicate: false }
}

export async function createValidatedHackCandidate(params: {
  id?: string
  problemId: string
  hackAttemptId: string
  createdBy: string
  baseTestSetRevisionId: string
  input: Buffer
  output: Buffer
  inputFileName: string
  outputFileName: string
  affectedSubtaskIds: number[]
}) {
  const inputSha256 = digest(params.input)
  const outputSha256 = digest(params.output)
  const previous = await prisma.testcaseCandidate.findUnique({ where: { hackAttemptId: params.hackAttemptId } })
  if (previous && (previous.inputSha256 !== inputSha256 || previous.outputSha256 !== outputSha256)) {
    throw new Error('Hack candidate content changed after validation')
  }
  if (!previous) {
    const admitted = await createAdmittedCandidate({ ...params, source: 'hack', targetRole: 'hack_gate', hackAttemptId: params.hackAttemptId })
    return prisma.testcaseCandidate.update({ where: { id: admitted.candidate.id }, data: { status: 'ELIGIBLE', evaluationStage: 'technical_validated' } })
  }
  const [inputObject, outputObject] = await Promise.all([ingestTestdataObject(params.problemId, params.input), ingestTestdataObject(params.problemId, params.output)])
  return prisma.testcaseCandidate.upsert({
    where: { hackAttemptId: params.hackAttemptId },
    update: {
      status: 'ELIGIBLE',
      evaluationStage: 'technical_validated',
      baseTestSetRevisionId: params.baseTestSetRevisionId,
      inputObjectId: inputObject.id,
      outputObjectId: outputObject.id,
      affectedSubtaskIds: params.affectedSubtaskIds.length ? JSON.stringify(params.affectedSubtaskIds) : null,
      message: null,
    },
    create: {
      id: params.id || crypto.randomUUID(),
      problemId: params.problemId,
      hackAttemptId: params.hackAttemptId,
      source: 'hack',
      status: 'ELIGIBLE',
      evaluationStage: 'technical_validated',
      baseTestSetRevisionId: params.baseTestSetRevisionId,
      inputObjectId: inputObject.id,
      outputObjectId: outputObject.id,
      inputSha256,
      outputSha256,
      inputSize: params.input.length,
      outputSize: params.output.length,
      inputFileName: params.inputFileName,
      outputFileName: params.outputFileName,
      affectedSubtaskIds: params.affectedSubtaskIds.length ? JSON.stringify(params.affectedSubtaskIds) : null,
      createdBy: params.createdBy,
    },
  })
}

export async function beginCandidatePromotion(candidateId: string) {
  const claimed = await prisma.testcaseCandidate.updateMany({
    where: { id: candidateId, status: { in: ['VALIDATED', 'ELIGIBLE', 'SELECTED'] } },
    data: { status: 'PROMOTING' },
  })
  return claimed.count === 1
}

export function completeCandidatePromotion(
  tx: Prisma.TransactionClient,
  params: { candidateId: string; testcaseId: string; revisionId: string; message?: string | null },
) {
  return tx.testcaseCandidate.updateMany({
    where: { id: params.candidateId, status: 'PROMOTING' },
    data: {
      status: 'PROMOTED',
      promotedTestcaseId: params.testcaseId,
      promotedRevisionId: params.revisionId,
      message: params.message || null,
      promotedAt: new Date(),
    },
  })
}

export function setCandidateStatus(
  candidateId: string,
  status: Exclude<TestcaseCandidateStatus, 'PROMOTED'>,
  message?: string | null,
) {
  return prisma.testcaseCandidate.update({
    where: { id: candidateId },
    data: { status, message: message || null },
  })
}
