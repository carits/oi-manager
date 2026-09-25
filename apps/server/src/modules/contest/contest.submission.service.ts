import { prisma } from '../../prisma'
import { createQueuedSubmissionWithRun } from '../judge/application/judge-run.service'
import { lockRatingParticipantTx } from '../rating/application/contest-rating.service'
import { findCanonicalContestSubmissionIdentity } from '../contest/contest-query.facade'

export interface QueuedContestSubmissionInput {
  userId: string
  contest: {
    id: number
    scope: string
    type: string
    format: string
    organizationId?: string | null
    Team?: { organizationId: string | null } | null
  }
  contestProblem: {
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
export async function createQueuedContestSubmission(input: QueuedContestSubmissionInput) {
  // Platform contests are account-level participation. Keep their submissions
  // visible in the personal account history while the Contest itself retains
  // the explicit `platform` ownership scope.
  const workspaceScope = input.contest.scope === 'platform' ? 'personal' : input.contest.scope
  const canonicalContestIdentity = input.contest.type === 'contest'
    ? await findCanonicalContestSubmissionIdentity(input.contest.id, input.contestProblem.id)
    : null
  if (input.contest.type === 'contest' && !canonicalContestIdentity) {
    throw new Error('Contest submission cannot be queued before its canonical identity is available')
  }
  const submission = await createQueuedSubmissionWithRun({
      userId: input.userId,
      workspaceScope,
      organizationId: input.contest.scope === 'campus'
        ? input.contest.organizationId || input.contest.Team?.organizationId || null
        : null,
      oj: input.contestProblem.Problem.platform,
      problemId: input.contestProblem.Problem.problemId,
      language: input.language,
      code: input.code,
      codeLength: Buffer.byteLength(input.code, 'utf8'),
            submitMethod: input.submitMethod,
      problemInternalId: input.contestProblem.Problem.id,
      submitScope: input.contest.type === 'contest' ? 'contest' : 'contest',
      testSetRevisionId: input.contestProblem.testSetRevisionId || input.contestProblem.Problem.latestTestSetRevisionId || null,
      judgeConfigHash: input.contestProblem.TestSetRevision?.judgeConfigHash || input.contestProblem.Problem.LatestTestSetRevision?.judgeConfigHash || null,
      inputFilename: input.inputFilename || null,
      outputFilename: input.outputFilename || null,
      ioAdapterVersion: input.ioAdapterVersion ?? 1,
      ...(canonicalContestIdentity || {}),
      isGlobalVisible: input.contest.type === 'contest' ? false : true,
      ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
      ...(input.sourceId ? { sourceId: input.sourceId, submitSource: 'demo_scenario' } : {}),
  }, {
    requestedBy: input.userId,
    afterSubmissionCreated: input.contest.type === 'contest'
      ? (tx, created) => lockRatingParticipantTx(tx, input.contest, input.userId, created.createdAt)
      : undefined,
  })
  if (input.contestProblem.Problem.platform === 'carits') {
    return prisma.submission.update({ where: { id: submission.id }, data: { ojRemoteId: submission.id.toString() } })
  }
  return submission
}
