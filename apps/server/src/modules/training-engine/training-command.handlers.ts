import type { Prisma, TrainingEngineSessionStatus, TrainingEngineTargetType } from '@prisma/client'
import { TrainingEngineError } from './training-engine.errors'
import { TrainingEventTypes } from './training-events'

type JsonRecord = Record<string, any>

export type TrainingRuntimeCommandContext = {
  tx: Prisma.TransactionClient
  current: any
  session: any
  sessionId: string
  userId: string
  type: string
  targetType: TrainingEngineTargetType
  targetId: string | null
  payload: JsonRecord
  update: Prisma.TrainingSessionUpdateInput
  setNextStatus: (status: TrainingEngineSessionStatus | undefined) => void
  activeStageIncrement: (stage: any, at: Date) => number
  sameOverlayTarget: (...args: any[]) => any
  restoreFocusParticipants: (...args: any[]) => Promise<any>
  targetApplies: (...args: any[]) => boolean
  boundedText: (value: unknown, maxLength: number, label: string, minLength?: number) => string
  asJson: (value: unknown) => Prisma.InputJsonValue | undefined
  appendEvent: (...args: any[]) => Promise<any>
}

export function createTrainingRuntimeCommandHandlers(context: TrainingRuntimeCommandContext) {
  const {
    tx,
    current,
    session,
    sessionId,
    userId,
    type,
    targetType,
    targetId,
    payload,
    update,
    setNextStatus,
    activeStageIncrement,
    sameOverlayTarget,
    restoreFocusParticipants,
    targetApplies,
    boundedText,
    asJson,
    appendEvent,
  } = context

  const pauseSession = async () => {
    if (current.status !== 'RUNNING') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有进行中的训练可以暂停')
    const at = new Date()
    setNextStatus('PAUSED')
    update.status = 'PAUSED'
    update.pausedAt = at
    update.runningSince = null
    update.pauseMode = payload.mode === 'HARD' ? 'HARD' : 'SOFT'
    if (current.runningSince) {
      update.activeElapsedSeconds = {
        increment: Math.max(0, Math.floor((at.getTime() - current.runningSince.getTime()) / 1000)),
      }
    }
    const runningStage = await tx.trainingSessionStage.findFirst({
      where: { sessionId, lifecycle: 'RUNNING', runningSince: { not: null } },
      select: { id: true, runningSince: true },
    })
    if (runningStage) await tx.trainingSessionStage.update({
      where: { id: runningStage.id },
      data: {
        activeElapsedSeconds: { increment: runningStage.runningSince ? Math.max(0, Math.floor((at.getTime() - runningStage.runningSince.getTime()) / 1000)) : 0 },
        runningSince: null,
      },
    })
  }

  const resumeSession = async () => {
    if (current.status !== 'PAUSED') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有暂停中的训练可以恢复')
    setNextStatus('RUNNING')
    update.status = 'RUNNING'
    update.pausedAt = null
    update.runningSince = new Date()
    update.pauseMode = null
    await tx.trainingSessionStage.updateMany({
      where: { sessionId, lifecycle: 'RUNNING', runningSince: null },
      data: { runningSince: new Date() },
    })
  }

  const problemInActiveUnit = async (stageProblemId: string) => {
    const runtime = await tx.trainingSession.findUnique({
      where: { id: sessionId },
      select: { currentStageId: true },
    })
    if (!runtime?.currentStageId) return false

    let groupIds: string[]
    if (targetType === 'GROUP' && targetId) {
      groupIds = [targetId]
    } else if (targetType === 'USER' && targetId) {
      const participant = await tx.trainingSessionParticipant.findUnique({
        where: { sessionId_userId: { sessionId, userId: targetId } },
        select: { groupId: true },
      })
      groupIds = participant ? [participant.groupId] : []
    } else {
      const participants = await tx.trainingSessionParticipant.findMany({
        where: { sessionId, status: 'active' },
        select: { groupId: true },
        distinct: ['groupId'],
      })
      groupIds = participants.map(participant => participant.groupId)
    }

    const plans = await tx.trainingSessionStageGroup.findMany({
      where: {
        stageId: runtime.currentStageId,
        OR: [
          { isDefault: true },
          ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
        ],
      },
      include: { ProblemPlans: { select: { stageProblemId: true } } },
    })
    const defaultPlan = plans.find(plan => plan.isDefault)
    const defaultHasProblem = Boolean(defaultPlan?.ProblemPlans.some(problem => problem.stageProblemId === stageProblemId))
    if (groupIds.length === 0) return defaultHasProblem

    return groupIds.every(groupId => {
      const override = plans.find(plan => plan.groupId === groupId)
      if (override?.ProblemPlans.some(problem => problem.stageProblemId === stageProblemId)) return true
      if (override && !override.inheritsDefault) return false
      return defaultHasProblem
    })
  }

  const appliesToParticipant = (participant: { groupId: string; userId: string }) => targetApplies(
    targetType,
    targetId,
    { ...participant, currentGroupId: participant.groupId },
    session,
  )

  const focusProblem = async () => {
    if (current.status !== 'RUNNING') throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '只有进行中的训练可以聚焦题目')
    const stageProblemId = String(payload.stageProblemId || '')
    if (
      !(await problemInActiveUnit(stageProblemId))
    ) {
      throw new TrainingEngineError(422, 'TRAINING_PROBLEM_NOT_IN_CURRENT_STAGE', '只能聚焦当前阶段的题目')
    }
    await tx.trainingSessionOverlay.updateMany({
      where: {
        sessionId,
        status: 'active',
        type: { in: ['SOFT_FOCUS', 'LOCKED_FOCUS', 'EXAM_FOCUS'] },
        ...sameOverlayTarget(targetType, targetId),
      },
      data: { status: 'ended', endedAt: new Date() },
    })
    await tx.trainingSessionOverlay.create({
      data: {
        sessionId,
        type: ['SOFT_FOCUS', 'EXAM_FOCUS'].includes(String(payload.mode)) ? String(payload.mode) : 'LOCKED_FOCUS',
        targetType,
        targetId,
        stageProblemId,
        payload: asJson(payload),
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
        createdBy: userId,
      },
    })
    const participants = await tx.trainingSessionParticipant.findMany({ where: { sessionId, status: 'active' } })
    for (const participant of participants.filter(appliesToParticipant)) {
      await tx.trainingSessionParticipant.update({
        where: { id: participant.id },
        data: {
          returnProblemId: participant.returnProblemId || participant.currentProblemId,
          currentProblemId: stageProblemId,
        },
      })
    }
  }

  const endFocus = async () => {
    if (!['RUNNING', 'PAUSED'].includes(current.status)) throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '当前状态不能结束聚焦')
    await tx.trainingSessionOverlay.updateMany({
      where: {
        sessionId,
        status: 'active',
        type: { in: ['SOFT_FOCUS', 'LOCKED_FOCUS', 'EXAM_FOCUS'] },
        ...sameOverlayTarget(targetType, targetId),
      },
      data: { status: 'ended', endedAt: new Date() },
    })
    const participants = await tx.trainingSessionParticipant.findMany({
      where: {
        sessionId,
        status: 'active',
        returnProblemId: { not: null },
      },
    })
    await restoreFocusParticipants(tx, session, participants.filter(appliesToParticipant))
  }

  const createOverlay = async () => {
    if (!['RUNNING', 'PAUSED'].includes(current.status)) throw new TrainingEngineError(409, 'INVALID_TRAINING_TRANSITION', '当前状态不能应用实时规则')
    if (type === 'LOCK_PROBLEM' && !payload.stageProblemId) {
      throw new TrainingEngineError(422, 'TRAINING_PROBLEM_REQUIRED', '锁题命令必须指定训练题目')
    }
    if (
      type === 'LOCK_PROBLEM'
      && (
        !(await problemInActiveUnit(String(payload.stageProblemId)))
      )
    ) {
      throw new TrainingEngineError(422, 'TRAINING_PROBLEM_NOT_IN_CURRENT_STAGE', '只能锁定当前阶段的题目')
    }
    if (type === 'SHOW_MESSAGE') {
      payload.message = boundedText(payload.message, 2000, '教练消息', 1)
      payload.messageType = ['INFO', 'WARNING', 'INSTRUCTION', 'COUNTDOWN'].includes(String(payload.messageType || '').toUpperCase())
        ? String(payload.messageType).toUpperCase()
        : 'INFO'
    }
    await tx.trainingSessionOverlay.create({
      data: {
        sessionId,
        type: type === 'SHOW_MESSAGE' ? 'MESSAGE' : type,
        targetType,
        targetId,
        stageProblemId: payload.stageProblemId ? String(payload.stageProblemId) : null,
        payload: asJson(payload),
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
        createdBy: userId,
      },
    })
  }

  const endOverlay = async () => {
    if (
      type === 'UNLOCK_PROBLEM'
      && payload.stageProblemId
      && (
        !(await problemInActiveUnit(String(payload.stageProblemId)))
      )
    ) {
      throw new TrainingEngineError(422, 'TRAINING_PROBLEM_NOT_IN_CURRENT_STAGE', '只能解锁当前阶段的题目')
    }
    const endingType = type === 'ENABLE_SUBMISSION'
      ? 'DISABLE_SUBMISSION'
      : type === 'UNLOCK_PROBLEM'
        ? 'LOCK_PROBLEM'
        : 'MESSAGE'
    await tx.trainingSessionOverlay.updateMany({
      where: {
        sessionId,
        status: 'active',
        type: endingType,
        ...sameOverlayTarget(targetType, targetId),
        ...(payload.stageProblemId ? { stageProblemId: String(payload.stageProblemId) } : {}),
      },
      data: { status: 'ended', endedAt: new Date() },
    })
  }

  const userIntervention = async () => {
    if (targetType !== 'USER' || !targetId) {
      throw new TrainingEngineError(422, 'TRAINING_COMMAND_TARGET_REQUIRED', '个人干预必须指定用户')
    }
    const participant = await tx.trainingSessionParticipant.findUnique({
      where: { sessionId_userId: { sessionId, userId: targetId } },
    })
    if (!participant) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_NOT_FOUND', '学员不在当前训练')
    if (
      payload.stageProblemId
      && (
        !(await problemInActiveUnit(String(payload.stageProblemId)))
      )
    ) {
      throw new TrainingEngineError(422, 'TRAINING_PROBLEM_NOT_IN_CURRENT_STAGE', '个人干预只能作用于当前阶段的题目')
    }
    await tx.trainingSessionUserOverride.create({
      data: {
        sessionId,
        userId: targetId,
        type: type === 'SKIP_FOR_USER' ? 'SKIP_PROBLEM' : 'UNLOCK_PROBLEM',
        stageProblemId: payload.stageProblemId ? String(payload.stageProblemId) : null,
        payload: asJson(payload),
        expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
        createdBy: userId,
      },
    })
    if (type === 'SKIP_FOR_USER' && payload.stageProblemId) {
      await tx.trainingSessionProblemProgress.upsert({
        where: {
          participantId_stageProblemId: {
            participantId: participant.id,
            stageProblemId: String(payload.stageProblemId),
          },
        },
        update: { status: 'SKIPPED', lastProgressAt: new Date() },
        create: {
          participantId: participant.id,
          stageProblemId: String(payload.stageProblemId),
          status: 'SKIPPED',
          lastProgressAt: new Date(),
        },
      })
    }
  }

  const clearStuckForUser = async () => {
    if (targetType !== 'USER' || !targetId) {
      throw new TrainingEngineError(422, 'TRAINING_COMMAND_TARGET_REQUIRED', '清除卡题状态必须指定用户')
    }
    const participant = await tx.trainingSessionParticipant.findUnique({
      where: { sessionId_userId: { sessionId, userId: targetId } },
    })
    if (!participant) throw new TrainingEngineError(422, 'TRAINING_PARTICIPANT_NOT_FOUND', '学员不在当前训练')
    const stageProblemId = String(payload.stageProblemId || '')
    if (
      !stageProblemId
      || !(await problemInActiveUnit(stageProblemId))
    ) {
      throw new TrainingEngineError(422, 'TRAINING_PROBLEM_NOT_IN_CURRENT_STAGE', '只能清除当前阶段题目的卡题状态')
    }
    const progress = await tx.trainingSessionProblemProgress.findUnique({
      where: { participantId_stageProblemId: { participantId: participant.id, stageProblemId } },
    })
    if (progress?.status === 'STUCK') {
      await tx.trainingSessionProblemProgress.update({
        where: { id: progress.id },
        data: {
          status: 'WORKING',
          stuckDetectedAt: null,
          continuousActiveSeconds: 0,
          lastProgressAt: new Date(),
        },
      })
      await appendEvent(tx, sessionId, TrainingEventTypes.PROBLEM_STUCK_CLEARED, 'USER', targetId, {
        participantId: participant.id,
        stageProblemId,
        reason: 'teacher_clear',
        at: new Date().toISOString(),
      })
    }
  }

  const hintControl = async () => {
    const hintId = String(payload.hintId || '')
    const hint = await tx.trainingSessionHint.findFirst({ where: { id: hintId, sessionId } })
    if (!hint) throw new TrainingEngineError(422, 'TRAINING_HINT_NOT_FOUND', '提示不存在')
    if (targetType === 'ALL') {
      await tx.trainingSessionHint.update({
        where: { id: hintId },
        data: { globallyOpenedAt: type === 'OPEN_HINT' ? new Date() : null },
      })
    }
    if (type === 'OPEN_HINT') {
      const existing = await tx.trainingSessionOverlay.findFirst({
        where: {
          sessionId,
          status: 'active',
          type: 'HINT_OPEN',
          ...sameOverlayTarget(targetType, targetId),
          payload: { path: ['hintId'], equals: hintId },
        },
        select: { id: true },
      })
      if (!existing) {
        await tx.trainingSessionOverlay.create({
          data: {
            sessionId,
            type: 'HINT_OPEN',
            targetType,
            targetId,
            stageProblemId: hint.stageProblemId,
            payload: { hintId },
            createdBy: userId,
          },
        })
      }
    } else {
      await tx.trainingSessionOverlay.updateMany({
        where: {
          sessionId,
          status: 'active',
          type: 'HINT_OPEN',
          ...sameOverlayTarget(targetType, targetId),
          payload: { path: ['hintId'], equals: hintId },
        },
        data: { status: 'ended', endedAt: new Date() },
      })
    }
  }

  return {
    PAUSE_SESSION: pauseSession,
    RESUME_SESSION: resumeSession,
    FOCUS_PROBLEM: focusProblem,
    END_FOCUS: endFocus,
    DISABLE_SUBMISSION: createOverlay,
    LOCK_PROBLEM: createOverlay,
    SHOW_MESSAGE: createOverlay,
    ENABLE_SUBMISSION: endOverlay,
    UNLOCK_PROBLEM: endOverlay,
    CLEAR_MESSAGE: endOverlay,
    UNLOCK_FOR_USER: userIntervention,
    SKIP_FOR_USER: userIntervention,
    CLEAR_STUCK_FOR_USER: clearStuckForUser,
    OPEN_HINT: hintControl,
    CLOSE_HINT: hintControl,
  }
}
