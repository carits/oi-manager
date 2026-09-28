import { v4 as uuidv4 } from 'uuid'
import { prisma } from '../../../prisma'
import { findAccessibleProblem } from '../../problem/problem.access'
import { ensureInitialTestSetSlots } from '../../problem/problem.testset-slot.service'
import { buildContestProblemData } from '../contest.helpers'
import {
  createContestProblemTx,
  deleteContestProblemTx,
  reorderContestProblemsTx,
  updateContestProblemTx,
} from '../../contest/contest-command.service'

export class ContestProblemManagementError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message) }
}

export async function addManagedContestProblem(params: {
  contest: any
  user: any
  problemId: string
  alias?: string | null
  points?: number | null
  statementOptionKey?: string
  solutionOptionKey?: string
}) {
  const { contest, user, problemId } = params
  const accessible = await findAccessibleProblem(user, problemId, 'use')
  let problem = accessible ? await prisma.problem.findUnique({
    where: { id: accessible.id },
    include: { TestSetSlots: { where: { slot: 'STABLE' } }, ProblemStatement: { where: { isVisible: true } } },
  }) : null
  if (!problem) throw new ContestProblemManagementError(404, 'PROBLEM_NOT_FOUND', '题目不存在')

  const schoolId = contest.organizationId ||
    (contest.scope === 'campus' && contest.Team?.scope === 'campus' ? contest.Team.organizationId : null)
  if (problem.libraryScope === 'organization' && schoolId !== problem.organizationId) {
    throw new ContestProblemManagementError(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }
  if (!problem.TestSetSlots.length) {
    try { await ensureInitialTestSetSlots(problem.id, user.userId) }
    catch (error: any) {
      throw new ContestProblemManagementError(409, 'TEST_SET_STABLE_REQUIRED', error.message)
    }
    problem = await prisma.problem.findUnique({
      where: { id: problem.id },
      include: { TestSetSlots: { where: { slot: 'STABLE' } }, ProblemStatement: { where: { isVisible: true } } },
    })
    if (!problem) throw new ContestProblemManagementError(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }

  try {
    const result = await prisma.$transaction(tx => createContestProblemTx(tx, contest.id, {
      id: uuidv4(),
      problemId,
      alias: params.alias || null,
      points: params.points || null,
      ...buildContestProblemData(problem),
    }))
    if (result.conflict || !result.problem) {
      throw new ContestProblemManagementError(404, 'CONTEST_NOT_FOUND', '比赛不存在')
    }
    return result.problem
  } catch (error: any) {
    if (error.code === 'P2002') throw new ContestProblemManagementError(400, 'DUPLICATE_PROBLEM', '别名或题号已存在')
    throw error
  }
}

export async function reorderManagedContestProblems(contestId: number, orders: Array<{ id: string; orderIndex: number }>) {
  const result = await prisma.$transaction(tx => reorderContestProblemsTx(tx, contestId, orders))
  if (result.conflict === 'scope') {
    throw new ContestProblemManagementError(400, 'INVALID_PROBLEM_SCOPE', '部分题目ID不属于该比赛')
  }
  if (result.conflict === 'order') {
    throw new ContestProblemManagementError(400, 'INVALID_PROBLEM_ORDER', '必须提交全部题目且排序值连续、不重复')
  }
}

export async function updateManagedContestProblem(
  contestId: number,
  contestProblemId: string,
  patch: { alias?: string | null; points?: number | null },
) {
  const result = await prisma.$transaction(tx => updateContestProblemTx(
    tx, contestId, contestProblemId, patch,
  ))
  if (result.conflict || !result.problem) {
    throw new ContestProblemManagementError(403, 'INVALID_PROBLEM_SCOPE', '题目不属于该比赛')
  }
  return result.problem
}

export async function deleteManagedContestProblem(contestId: number, contestProblemId: string) {
  const result = await prisma.$transaction(tx => deleteContestProblemTx(tx, contestId, contestProblemId))
  if (result.conflict) {
    throw new ContestProblemManagementError(403, 'INVALID_PROBLEM_SCOPE', '题目不属于该比赛')
  }
}
