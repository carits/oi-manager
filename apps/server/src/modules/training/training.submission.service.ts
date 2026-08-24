import { prisma } from '../../prisma'

export interface QueuedTrainingSubmissionInput {
  userId: string
  training: {
    id: number
    scope: string
    type: string
    organizationId?: string | null
    Team?: { organizationId: string | null } | null
  }
  trainingProblem: { id: string; Problem: { id: string; platform: string; problemId: string } }
  language: string
  code: string
  submitMethod: string
  createdAt?: Date
  sourceId?: string
}

// Normal and development submissions use one local judge queue path.
export async function createQueuedTrainingSubmission(input: QueuedTrainingSubmissionInput) {
  const submission = await prisma.submission.create({
    data: {
      userId: input.userId,
      workspaceScope: input.training.scope,
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
      ...(input.training.type === 'contest' ? { contestId: input.training.id, contestProblemId: input.trainingProblem.id } : {}),
      isGlobalVisible: input.training.type === 'contest' ? false : true,
      ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
      ...(input.sourceId ? { sourceId: input.sourceId, submitSource: 'demo_scenario' } : {}),
    },
  })
  if (input.trainingProblem.Problem.platform === 'carits') {
    return prisma.submission.update({ where: { id: submission.id }, data: { ojRemoteId: submission.id.toString() } })
  }
  return submission
}
