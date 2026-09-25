import yaml from 'js-yaml'
import { prisma } from '../../prisma'
import { currentJudgeInProgressWhere } from '../judge/application/judge-read-projection'

export class ActivityRevisionRepairError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

type RepairUpdate = {
  trainingProblemId: string
  expectedCurrentRevisionId: string
  targetRevisionId: string
}

const revisionInclude = {
  AcmCases: {
    orderBy: { orderIndex: 'asc' as const },
    select: { testcaseId: true, inputObjectId: true, outputObjectId: true, inputName: true, outputName: true, orderIndex: true, time: true, memory: true, source: true },
  },
  Subtasks: {
    orderBy: { orderIndex: 'asc' as const },
    select: {
      subtaskId: true,
      orderIndex: true,
      Groups: {
        orderBy: { orderIndex: 'asc' as const },
        select: {
          key: true,
          kind: true,
          orderIndex: true,
          Cases: {
            orderBy: { orderIndex: 'asc' as const },
            select: { testcaseId: true, inputObjectId: true, outputObjectId: true, inputName: true, outputName: true, orderIndex: true, time: true, memory: true, source: true },
          },
        },
      },
    },
  },
} as const

export function revisionDataLayout(revision: any) {
  return revision.mode === 'acm'
    ? {
        mode: revision.mode,
        cases: revision.AcmCases.map((item: any) => ({
          testcaseId: item.testcaseId,
          inputObjectId: item.inputObjectId,
          outputObjectId: item.outputObjectId,
          inputName: item.inputName,
          outputName: item.outputName,
          orderIndex: item.orderIndex,
          time: item.time,
          memory: item.memory,
          source: item.source,
        })),
      }
    : {
        mode: revision.mode,
        subtasks: revision.Subtasks.map((subtask: any) => ({
          subtaskId: subtask.subtaskId,
          orderIndex: subtask.orderIndex,
          groups: subtask.Groups.map((group: any) => ({
            kind: group.kind,
            orderIndex: group.orderIndex,
            cases: group.Cases.map((item: any) => ({
              testcaseId: item.testcaseId,
              inputObjectId: item.inputObjectId,
              outputObjectId: item.outputObjectId,
              inputName: item.inputName,
              outputName: item.outputName,
              orderIndex: item.orderIndex,
              time: item.time,
              memory: item.memory,
              source: item.source,
            })),
          })),
        })),
      }
}

function stableValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value
}

export function nonScoringJudgeConfig(configText: string) {
  const parsed = (yaml.load(configText) || {}) as Record<string, any>
  const { subtasks: _subtasks, ...rest } = parsed
  return stableValue(rest)
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
}

export function isAllowedRepairSuccessor(current: { id: string; mode: string }, target: {
  parentRevisionId: string | null
  mode: string
  source: string
}) {
  return target.parentRevisionId === current.id
    && target.mode === current.mode
    && (target.source === 'admin_edit' || target.source === 'initial')
}

export async function repairActivityRevisionPins(input: {
  trainingId: number
  updates: RepairUpdate[]
  apply: boolean
}) {
  if (!Number.isInteger(input.trainingId) || input.trainingId <= 0) {
    throw new ActivityRevisionRepairError(400, 'INVALID_TRAINING_ID', 'trainingId 无效')
  }
  if (!Array.isArray(input.updates) || input.updates.length === 0) {
    throw new ActivityRevisionRepairError(400, 'REVISION_REPAIR_UPDATES_REQUIRED', '至少提供一项版本修复')
  }
  const duplicateIds = input.updates.map(item => item.trainingProblemId)
  if (new Set(duplicateIds).size !== duplicateIds.length) {
    throw new ActivityRevisionRepairError(400, 'DUPLICATE_TRAINING_PROBLEM', '同一道活动题不能重复修复')
  }

  return prisma.$transaction(async tx => {
    const training = await tx.contest.findUnique({ where: { publicId: input.trainingId }, select: { id: true, publicId: true, title: true } })
    if (!training) throw new ActivityRevisionRepairError(404, 'CONTEST_NOT_FOUND', '比赛不存在')
    const results = []

    for (const update of input.updates) {
      const item = await tx.contestProblem.findFirst({
        where: { id: update.trainingProblemId, contestId: training.id },
        select: {
          id: true,
          alias: true,
          canonicalProblemId: true,
          testSetRevisionId: true,
          CanonicalProblem: { select: { title: true, latestTestSetRevisionId: true } },
        },
      })
      if (!item) throw new ActivityRevisionRepairError(404, 'TRAINING_PROBLEM_NOT_FOUND', `活动题 ${update.trainingProblemId} 不存在`)
      if (item.testSetRevisionId !== update.expectedCurrentRevisionId) {
        throw new ActivityRevisionRepairError(409, 'ACTIVITY_REVISION_STALE', `${item.alias || item.CanonicalProblem?.title || item.id} 当前版本已变化，请重新检查`)
      }
      if (item.CanonicalProblem?.latestTestSetRevisionId !== update.targetRevisionId) {
        throw new ActivityRevisionRepairError(409, 'TARGET_NOT_LATEST_REVISION', `${item.alias || item.CanonicalProblem?.title || item.id} 目标不是题库最新版`)
      }

      const [current, target] = await Promise.all([
        tx.problemTestSetRevision.findFirst({ where: { id: update.expectedCurrentRevisionId, problemId: item.canonicalProblemId! }, include: revisionInclude }),
        tx.problemTestSetRevision.findFirst({ where: { id: update.targetRevisionId, problemId: item.canonicalProblemId! }, include: revisionInclude }),
      ])
      if (!current || !target) throw new ActivityRevisionRepairError(404, 'REVISION_NOT_FOUND', `${item.alias || item.CanonicalProblem?.title || item.id} 的测试版本不存在`)
      if (!isAllowedRepairSuccessor(current, target)) {
        throw new ActivityRevisionRepairError(409, 'UNSAFE_REVISION_REPAIR', `${item.alias || item.CanonicalProblem?.title || item.id} 仅允许修复到同模式的直接人工或历史迁移后继版本`)
      }
      if (!sameValue(revisionDataLayout(current), revisionDataLayout(target))) {
        throw new ActivityRevisionRepairError(409, 'TESTDATA_LAYOUT_CHANGED', `${item.alias || item.CanonicalProblem?.title || item.id} 的测试数据布局发生变化，不能原位修复`)
      }
      if (!sameValue(nonScoringJudgeConfig(current.judgeConfig), nonScoringJudgeConfig(target.judgeConfig))) {
        throw new ActivityRevisionRepairError(409, 'NON_SCORING_CONFIG_CHANGED', `${item.alias || item.CanonicalProblem?.title || item.id} 存在非计分配置变化，不能原位修复`)
      }

      const submissionWhere = { canonicalContestId: training.id, canonicalContestProblemId: item.id }
      const [submissionCount, inProgressCount] = await Promise.all([
        tx.submission.count({ where: submissionWhere }),
        tx.submission.count({ where: { ...submissionWhere, AND: [currentJudgeInProgressWhere()] } }),
      ])
      if (inProgressCount > 0) {
        throw new ActivityRevisionRepairError(409, 'REVISION_REPAIR_IN_PROGRESS', `${item.alias || item.CanonicalProblem?.title || item.id} 仍有 ${inProgressCount} 条提交正在排队或评测`)
      }

      if (input.apply) {
        await tx.contestProblem.update({
          where: { id: item.id },
          data: { testSetRevisionId: target.id, updatedAt: new Date() },
        })
        await tx.submission.updateMany({
          where: submissionWhere,
          data: { testSetRevisionId: target.id, judgeConfigHash: target.judgeConfigHash },
        })
      }
      results.push({
        trainingProblemId: item.id,
        alias: item.alias,
        problemTitle: item.CanonicalProblem?.title || item.id,
        previousRevisionId: current.id,
        previousRevision: current.revisionNumber,
        targetRevisionId: target.id,
        targetRevision: target.revisionNumber,
        submissionCount,
        applied: input.apply,
      })
    }
    return { trainingId: training.publicId, trainingTitle: training.title, applied: input.apply, results }
  }, { isolationLevel: 'Serializable' })
}
