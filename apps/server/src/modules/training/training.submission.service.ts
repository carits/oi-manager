import { prisma } from '../../prisma'
import { createQueuedSubmissionWithRun } from '../judge/application/judge-run.service'
import { lockRatingParticipantTx } from '../rating/application/contest-rating.service'
import { findCanonicalContestSubmissionIdentity } from '../contest/contest-query.facade'

export interface QueuedTrainingSubmissionInput {
  userId: string
  training: {
    id: number
    scope: string
    type: string
    format: string
    organizationId?: string | null
    Team?: { organizationId: string | null } | null
  }
  trainingProblem: {
    id: string
    testSetRevisionId?: string | null
    TestSetRevision?: { judgeConfigHash: string } | null
    Problem: { id: string; platform: string; problemId: string; latestTestSetRevisionId?: string | null; LatestTestSetRevision?: { judgeConfigHash: string } | null }
  }
  language: string
  code: string
  submitMethod: string
  inputFilename?: string | null
  outputFilename?: string | null
  ioAdapterVersion?: number
  createdAt?: Date
  sourceId?: string
}

// Normal and development submissions use one local judge queue path.
export async function createQueuedTrainingSubmission(input: QueuedTrainingSubmissionInput) {
  // Platform contests are account-level participation. Keep their submissions
  // visible in the personal account history while the Training itself retains
  // the explicit `platform` ownership scope.
  const workspaceScope = input.training.scope === 'platform' ? 'personal' : input.training.scope
  const canonicalContestIdentity = input.training.type === 'contest'
    ? await findCanonicalContestSubmissionIdentity(input.training.id, input.trainingProblem.id)
    : null
  if (input.training.type === 'contest' && !canonicalContestIdentity) {
    throw new Error('Contest submission cannot be queued before its canonical identity is available')
  }
  const submission = await createQueuedSubmissionWithRun({
      userId: input.userId,
      workspaceScope,
      organizationId: input.training.scope === 'campus'
        ? input.training.organizationId || input.training.Team?.organizationId || null
        : null,
      oj: input.trainingProblem.Problem.platform,
      problemId: input.trainingProblem.Problem.problemId,
      language: input.language,
      code: input.code,
      codeLength: Buffer.byteLength(input.code, 'utf8'),
      result: 'queuing',
      submitMethod: input.submitMethod,
      problemInternalId: input.trainingProblem.Problem.id,
      submitScope: input.training.type === 'contest' ? 'contest' : 'training',
      trainingId: input.training.id,
      trainingProblemId: input.trainingProblem.id,
      testSetRevisionId: input.trainingProblem.testSetRevisionId || input.trainingProblem.Problem.latestTestSetRevisionId || null,
      judgeConfigHash: input.trainingProblem.TestSetRevision?.judgeConfigHash || input.trainingProblem.Problem.LatestTestSetRevision?.judgeConfigHash || null,
      inputFilename: input.inputFilename || null,
      outputFilename: input.outputFilename || null,
      ioAdapterVersion: input.ioAdapterVersion ?? 1,
      ...(canonicalContestIdentity || {}),
      isGlobalVisible: input.training.type === 'contest' ? false : true,
      ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
      ...(input.sourceId ? { sourceId: input.sourceId, submitSource: 'demo_scenario' } : {}),
  }, {
    requestedBy: input.userId,
    afterSubmissionCreated: input.training.type === 'contest'
      ? (tx, created) => lockRatingParticipantTx(tx, input.training, input.userId, created.createdAt)
      : undefined,
  })
  if (input.trainingProblem.Problem.platform === 'carits') {
    return prisma.submission.update({ where: { id: submission.id }, data: { ojRemoteId: submission.id.toString() } })
  }
  return submission
}
