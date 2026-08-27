import crypto from 'node:crypto'
import type { Prisma, TestcaseCandidateStatus } from '@prisma/client'
import { prisma } from '../../prisma'
import { ingestTestdataObject } from './problem.testset-revision.service'

function digest(content: Buffer) {
  return crypto.createHash('sha256').update(content).digest('hex')
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
  const [inputObject, outputObject] = await Promise.all([
    ingestTestdataObject(params.problemId, params.input),
    ingestTestdataObject(params.problemId, params.output),
  ])
  const previous = await prisma.testcaseCandidate.findUnique({ where: { hackAttemptId: params.hackAttemptId } })
  if (previous && (previous.inputSha256 !== inputSha256 || previous.outputSha256 !== outputSha256)) {
    throw new Error('Hack candidate content changed after validation')
  }
  return prisma.testcaseCandidate.upsert({
    where: { hackAttemptId: params.hackAttemptId },
    update: {
      status: 'VALIDATED',
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
      status: 'VALIDATED',
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
    where: { id: candidateId, status: 'VALIDATED' },
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
