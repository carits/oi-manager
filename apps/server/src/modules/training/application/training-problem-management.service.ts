import { v4 as uuidv4 } from 'uuid'
import { prisma } from '../../../prisma'
import { fileService } from '../../../lib/storage'
import { findAccessibleProblem } from '../../problem/problem.access'
import { ensureInitialTestSetRevision } from '../../problem/problem.testset-revision.service'
import {
  activityOrganizationId,
  createInitialContentSnapshots,
} from '../../problem/problem.content.service'
import { populateSnapshotData } from '../training.helpers'

export class TrainingProblemManagementError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message) }
}

export async function addManagedTrainingProblem(params: {
  training: any
  user: any
  problemId: string
  alias?: string | null
  points?: number | null
  statementOptionKey?: string
  solutionOptionKey?: string
}) {
  const { training, user, problemId } = params
  const accessible = await findAccessibleProblem(user, problemId, 'use')
  let problem = accessible ? await prisma.problem.findUnique({
    where: { id: accessible.id },
    include: { LatestTestSetRevision: true, ProblemStatement: { where: { isVisible: true } } },
  }) : null
  if (!problem) throw new TrainingProblemManagementError(404, 'PROBLEM_NOT_FOUND', '题目不存在')

  const schoolId = training.organizationId ||
    (training.scope === 'campus' && training.Team?.scope === 'campus' ? training.Team.organizationId : null)
  if (problem.libraryScope === 'organization' && schoolId !== problem.organizationId) {
    throw new TrainingProblemManagementError(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }
  if (!problem.latestTestSetRevisionId) {
    try { await ensureInitialTestSetRevision(problem.id, user.userId) }
    catch (error: any) {
      throw new TrainingProblemManagementError(409, 'TEST_SET_REVISION_REQUIRED', error.message)
    }
    problem = await prisma.problem.findUnique({
      where: { id: problem.id },
      include: { LatestTestSetRevision: true, ProblemStatement: { where: { isVisible: true } } },
    })
    if (!problem) throw new TrainingProblemManagementError(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }

  const maxOrder = await prisma.trainingProblem.aggregate({
    where: { trainingId: training.id }, _max: { orderIndex: true },
  })
  let created
  try {
    created = await prisma.trainingProblem.create({
      data: {
        id: uuidv4(),
        trainingId: training.id,
        problemId,
        alias: params.alias || null,
        points: params.points || null,
        orderIndex: (maxOrder._max.orderIndex ?? -1) + 1,
        ...populateSnapshotData(problem),
      },
    })
  } catch (error: any) {
    if (error.code === 'P2002') throw new TrainingProblemManagementError(400, 'DUPLICATE_PROBLEM', '别名或题号已存在')
    throw error
  }
  try {
    await createInitialContentSnapshots({
      trainingProblemId: created.id,
      problemId: problem.id,
      selectedBy: user.userId,
      organizationId: await activityOrganizationId(training),
      statementOptionKey: params.statementOptionKey,
      solutionOptionKey: params.solutionOptionKey,
    })
    return created
  } catch (error) {
    await prisma.trainingProblem.delete({ where: { id: created.id } })
    throw error
  }
}

export async function reorderManagedTrainingProblems(trainingId: number, orders: Array<{ id: string; orderIndex: number }>) {
  const existing = await prisma.trainingProblem.findMany({
    where: { trainingId }, select: { id: true },
  })
  const valid = new Set(existing.map(problem => problem.id))
  if (orders.some(order => !valid.has(order.id))) {
    throw new TrainingProblemManagementError(400, 'INVALID_PROBLEM_SCOPE', '部分题目ID不属于该训练')
  }
  if (new Set(orders.map(order => order.id)).size !== orders.length ||
      new Set(orders.map(order => order.orderIndex)).size !== orders.length) {
    throw new TrainingProblemManagementError(400, 'INVALID_PROBLEM_ORDER', '题目或排序值不能重复')
  }
  await prisma.$transaction([
    ...orders.map(order => prisma.trainingProblem.update({
      where: { id: order.id }, data: { orderIndex: -(order.orderIndex + 1) },
    })),
    ...orders.map(order => prisma.trainingProblem.update({
      where: { id: order.id }, data: { orderIndex: order.orderIndex },
    })),
  ])
}

export async function updateManagedTrainingProblem(
  trainingId: number,
  trainingProblemId: string,
  patch: { alias?: string | null; points?: number | null },
) {
  const existing = await prisma.trainingProblem.findUnique({
    where: { id: trainingProblemId }, select: { trainingId: true },
  })
  if (!existing || existing.trainingId !== trainingId) {
    throw new TrainingProblemManagementError(403, 'INVALID_PROBLEM_SCOPE', '题目不属于该训练')
  }
  return prisma.trainingProblem.update({
    where: { id: trainingProblemId },
    data: {
      ...(patch.alias !== undefined && { alias: patch.alias }),
      ...(patch.points !== undefined && { points: patch.points }),
    },
  })
}

export async function deleteManagedTrainingProblem(trainingId: number, trainingProblemId: string) {
  const existing = await prisma.trainingProblem.findUnique({
    where: { id: trainingProblemId }, select: { trainingId: true },
  })
  if (!existing || existing.trainingId !== trainingId) {
    throw new TrainingProblemManagementError(403, 'INVALID_PROBLEM_SCOPE', '题目不属于该训练')
  }
  const files = await prisma.trainingProblemContentSnapshot.findMany({
    where: { trainingProblemId, snapshotFileId: { not: null } }, select: { snapshotFileId: true },
  })
  await prisma.trainingProblem.delete({ where: { id: trainingProblemId } })
  await Promise.all(files.map(file => file.snapshotFileId
    ? fileService.softDelete(file.snapshotFileId).catch(() => {})
    : Promise.resolve()))
}
