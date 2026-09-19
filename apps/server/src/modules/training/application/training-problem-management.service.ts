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
import {
  createContestProblemTx,
  deleteContestProblemTx,
  reorderContestProblemsTx,
  updateContestProblemTx,
} from '../../contest/contest-command.service'

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

  let created
  try {
    if (training.type === 'contest') {
      const result = await prisma.$transaction(tx => createContestProblemTx(tx, training.id, {
        id: uuidv4(),
        problemId,
        alias: params.alias || null,
        points: params.points || null,
        ...populateSnapshotData(problem),
      }))
      if (result.conflict || !result.problem) {
        throw new TrainingProblemManagementError(404, 'TRAINING_NOT_FOUND', '比赛不存在')
      }
      created = result.problem
    } else {
      created = await prisma.$transaction(async tx => {
        const maxOrder = await tx.trainingProblem.aggregate({
          where: { trainingId: training.id }, _max: { orderIndex: true },
        })
      const row = await tx.trainingProblem.create({
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
      return row
      })
    }
  } catch (error: any) {
    if (error.code === 'P2002') throw new TrainingProblemManagementError(400, 'DUPLICATE_PROBLEM', '别名或题号已存在')
    throw error
  }
  if (training.type === 'contest') return created
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
    if (training.type === 'contest') {
      await prisma.$transaction(tx => deleteContestProblemTx(tx, training.id, created.id))
    } else {
      await prisma.trainingProblem.delete({ where: { id: created.id } })
    }
    throw error
  }
}

export async function reorderManagedTrainingProblems(trainingId: number, orders: Array<{ id: string; orderIndex: number }>) {
  const contest = await prisma.contest.findUnique({ where: { publicId: trainingId }, select: { id: true } })
  if (contest) {
    const result = await prisma.$transaction(tx => reorderContestProblemsTx(tx, trainingId, orders))
    if (result.conflict === 'scope') {
      throw new TrainingProblemManagementError(400, 'INVALID_PROBLEM_SCOPE', '部分题目ID不属于该比赛')
    }
    if (result.conflict === 'order') {
      throw new TrainingProblemManagementError(400, 'INVALID_PROBLEM_ORDER', '必须提交全部题目且排序值连续、不重复')
    }
    return
  }
  const existing = await prisma.trainingProblem.findMany({
    where: { trainingId }, select: { id: true },
  })
  const valid = new Set(existing.map(problem => problem.id))
  if (orders.length !== existing.length || orders.some(order => !valid.has(order.id))) {
    throw new TrainingProblemManagementError(400, 'INVALID_PROBLEM_SCOPE', '部分题目ID不属于该训练')
  }
  const expectedIndexes = new Set(existing.map((_, index) => index))
  if (new Set(orders.map(order => order.id)).size !== orders.length ||
      new Set(orders.map(order => order.orderIndex)).size !== orders.length ||
      orders.some(order => !Number.isInteger(order.orderIndex) || !expectedIndexes.has(order.orderIndex))) {
    throw new TrainingProblemManagementError(400, 'INVALID_PROBLEM_ORDER', '必须提交全部题目且排序值连续、不重复')
  }
  await prisma.$transaction(async tx => {
    for (const order of orders) {
      await tx.trainingProblem.update({ where: { id: order.id }, data: { orderIndex: -(order.orderIndex + 1) } })
    }
    for (const order of orders) {
      await tx.trainingProblem.update({ where: { id: order.id }, data: { orderIndex: order.orderIndex } })
    }
  })
}

export async function updateManagedTrainingProblem(
  trainingId: number,
  trainingProblemId: string,
  patch: { alias?: string | null; points?: number | null },
) {
  const contest = await prisma.contest.findUnique({ where: { publicId: trainingId }, select: { id: true } })
  if (contest) {
    const result = await prisma.$transaction(tx => updateContestProblemTx(
      tx, trainingId, trainingProblemId, patch,
    ))
    if (result.conflict || !result.problem) {
      throw new TrainingProblemManagementError(403, 'INVALID_PROBLEM_SCOPE', '题目不属于该比赛')
    }
    return result.problem
  }
  const existing = await prisma.trainingProblem.findUnique({
    where: { id: trainingProblemId }, select: { trainingId: true },
  })
  if (!existing || existing.trainingId !== trainingId) {
    throw new TrainingProblemManagementError(403, 'INVALID_PROBLEM_SCOPE', '题目不属于该训练')
  }
  return prisma.$transaction(async tx => {
    const updated = await tx.trainingProblem.update({
      where: { id: trainingProblemId },
      data: {
        ...(patch.alias !== undefined && { alias: patch.alias }),
        ...(patch.points !== undefined && { points: patch.points }),
      },
    })
    return updated
  })
}

export async function deleteManagedTrainingProblem(trainingId: number, trainingProblemId: string) {
  const contest = await prisma.contest.findUnique({ where: { publicId: trainingId }, select: { id: true } })
  if (contest) {
    const existing = await prisma.contestProblem.findUnique({
      where: { id: trainingProblemId }, select: { contestId: true },
    })
    if (!existing || existing.contestId !== contest.id) {
      throw new TrainingProblemManagementError(403, 'INVALID_PROBLEM_SCOPE', '题目不属于该比赛')
    }
    const result = await prisma.$transaction(tx => deleteContestProblemTx(tx, trainingId, trainingProblemId))
    if (result.conflict) {
      throw new TrainingProblemManagementError(403, 'INVALID_PROBLEM_SCOPE', '题目不属于该比赛')
    }
    return
  }
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
