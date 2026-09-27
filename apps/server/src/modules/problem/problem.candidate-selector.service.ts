import crypto from 'node:crypto'
import { prisma } from '../../prisma'
import {
  loadTestSetSlotSpec,
  replaceTestSetSlot,
  TestSetSlotFenceConflict,
  type SlotCaseSpec,
  type TestSetSlotSpec,
} from './problem.testset-slot.service'
import { OI_CANDIDATE_LIMITS, parseSubtaskIds, uniqueSubtaskCases } from './problem.oi-candidate-policy'
import { updateTerminalHackAttempt } from './problem.hack-state'
import { recordPromotedContribution } from '../contribution/application/contribution-reward.service'
import { queueCandidateEvaluation } from './problem.candidate-evaluation.service'

type SelectionDecision = {
  subtaskId: number
  selected: boolean
  reason: string
  caseCount: number
  caseLimit: number
}

function candidateCase(candidate: any): SlotCaseSpec {
  return {
    testcaseId: null,
    inputName: candidate.inputFileName,
    outputName: candidate.outputFileName,
    inputObjectId: candidate.InputObject.id,
    outputObjectId: candidate.OutputObject.id,
    source: candidate.source === 'hack' ? 'hack' : 'generated',
    score: candidate.targetRole === 'hack_gate' ? 100 : null,
  }
}

async function finalizeSuccessfulWriter(candidateId: string, writerId: string, selectionMode: string) {
  const writer = await prisma.problemTestSetWriter.findUnique({ where: { id: writerId } })
  if (!writer || writer.status !== 'SUCCEEDED') return false
  const slot = await prisma.problemTestSetSlot.findUnique({
    where: { problemId_slot: { problemId: writer.problemId, slot: 'EVOLVING' } },
  })
  if (!slot) return false
  await prisma.$transaction(async tx => {
    const candidate = await tx.testcaseCandidate.findUnique({ where: { id: candidateId } })
    if (!candidate || candidate.status === 'PROMOTED') return
    if (candidate.status !== 'SELECTED') throw new Error('Candidate 写任务完成时状态无效')
    await tx.testcaseCandidate.update({
      where: { id: candidate.id },
      data: {
        status: 'PROMOTED',
        promotedGraphHash: slot.graphHash,
        promotedAt: new Date(),
        evaluationStage: 'promoted',
        message: 'Candidate 已写入当前 Evolving 数据',
      },
    })
    await tx.canonicalSelectionRun.updateMany({
      where: { problemId: candidate.problemId, status: 'running', selectedCandidateIds: { array_contains: candidate.id } },
      data: { status: 'promoted', promotedGraphHash: slot.graphHash, finishedAt: new Date() },
    })
    if (candidate.hackAttemptId) {
      await updateTerminalHackAttempt(tx, {
        id: candidate.hackAttemptId,
        state: 'accepted',
        data: {
          canonicalStatus: 'promoted',
          promotedGraphHash: slot.graphHash,
          message: '技术 Hack 有效；Candidate 已由 Selector 写入 Evolving 数据',
        },
      })
    }
    await recordPromotedContribution(tx, {
      candidateId: candidate.id,
      promotedGraphHash: slot.graphHash,
      selectionMode,
    })
  })
  return true
}

export async function reconcileSelectedCandidateWriters(limit = 100) {
  const candidates = await prisma.testcaseCandidate.findMany({
    where: { status: 'SELECTED', evaluationStage: 'slot_writer_pending' },
    orderBy: { selectedAt: 'asc' },
    take: limit,
  })
  let completed = 0
  for (const candidate of candidates) {
    const writer = await prisma.problemTestSetWriter.findFirst({
      where: { problemId: candidate.problemId, slot: 'EVOLVING', sourceId: candidate.id },
      orderBy: { requestedAt: 'desc' },
    })
    if (!writer) continue
    if (writer.status === 'SUCCEEDED') {
      if (await finalizeSuccessfulWriter(candidate.id, writer.id, 'auto')) completed++
    } else if (writer.status === 'FAILED' || writer.status === 'CANCELLED') {
      await prisma.testcaseCandidate.updateMany({
        where: { id: candidate.id, status: 'SELECTED' },
        data: {
          status: 'ELIGIBLE',
          evaluationStage: 'writer_failed',
          message: writer.errorMessage || 'Evolving 写任务失败',
        },
      })
    }
  }
  return { checked: candidates.length, completed }
}

async function requeueStaleCandidate(candidate: any) {
  const slot = await prisma.problemTestSetSlot.findUnique({
    where: { problemId_slot: { problemId: candidate.problemId, slot: 'EVOLVING' } },
  })
  if (!slot) return
  await prisma.testcaseCandidate.updateMany({
    where: { id: candidate.id, status: { in: ['ELIGIBLE', 'ELIGIBLE_NOT_SELECTED', 'WAITING_REPLACEMENT', 'SELECTED'] } },
    data: {
      status: 'ADMITTED',
      evaluationStage: 'awaiting_evaluator',
      baseSlot: 'EVOLVING',
      baseGraphHash: slot.graphHash,
      baseFencingToken: slot.fencingToken,
      message: 'Evolving 数据已变化，Candidate 正在重新评估',
    },
  })
  await queueCandidateEvaluation(candidate.id).catch(() => undefined)
}

export async function maybeAutoSelectCandidate(
  candidateId: string,
  override?: { userId: string; reason: string },
  options?: { dryRun?: boolean },
) {
  const dryRun = options?.dryRun === true
  const candidate = await prisma.testcaseCandidate.findUnique({
    where: { id: candidateId },
    include: { InputObject: true, OutputObject: true },
  })
  if (!candidate?.InputObject || !candidate.OutputObject) return { promoted: false, reason: 'not_ready' }
  if (!['ELIGIBLE', 'ELIGIBLE_NOT_SELECTED', 'WAITING_REPLACEMENT'].includes(candidate.status)) {
    if (candidate.status === 'SELECTED') {
      const writer = await prisma.problemTestSetWriter.findFirst({
        where: { problemId: candidate.problemId, slot: 'EVOLVING', sourceId: candidate.id },
        orderBy: { requestedAt: 'desc' },
      })
      if (writer?.status === 'SUCCEEDED') {
        await finalizeSuccessfulWriter(candidate.id, writer.id, override ? 'emergency' : 'auto')
        return { promoted: true, graphHash: (await prisma.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId: candidate.problemId, slot: 'EVOLVING' } } }))?.graphHash }
      }
      return { promoted: false, reason: 'writer_pending', writerId: writer?.id }
    }
    return { promoted: false, reason: 'not_ready' }
  }
  if (candidate.targetRole !== 'hack_gate') return { promoted: false, reason: 'official_requires_group_assignment' }

  const [slot, spec, policy] = await Promise.all([
    prisma.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId: candidate.problemId, slot: 'EVOLVING' } } }),
    loadTestSetSlotSpec(candidate.problemId, 'EVOLVING'),
    prisma.problemCandidatePolicy.upsert({
      where: { problemId: candidate.problemId },
      update: {},
      create: { id: crypto.randomUUID(), problemId: candidate.problemId, updatedBy: candidate.createdBy },
    }),
  ])
  if (!slot || !spec) return { promoted: false, reason: 'evolving_missing' }
  if (candidate.baseSlot !== 'EVOLVING' || candidate.baseGraphHash !== slot.graphHash || candidate.baseFencingToken !== slot.fencingToken) {
    if (!dryRun) await requeueStaleCandidate(candidate)
    return { promoted: false, reason: 'stale_requeued' }
  }
  if (!override && !dryRun && policy.selectorMode !== 'auto') return { promoted: false, reason: 'observe_mode' }
  const recentPublishes = await prisma.canonicalSelectionRun.count({
    where: { problemId: candidate.problemId, status: 'promoted', createdAt: { gte: new Date(Date.now() - 60 * 60_000) } },
  })
  if (!override && !dryRun && recentPublishes >= Math.min(3, policy.maxAutoPublishesPerHour)) {
    return { promoted: false, reason: 'publish_rate_limited' }
  }

  const decisions: SelectionDecision[] = []
  const nextSpec: TestSetSlotSpec = structuredClone(spec)
  const nextCase = candidateCase(candidate)
  if (nextSpec.mode === 'acm') {
    const cases = nextSpec.cases || []
    const selected = cases.length < Math.min(100, policy.maxCanonicalCases)
    decisions.push({
      subtaskId: 0,
      selected,
      reason: selected ? 'capacity_available' : 'ACM_CASE_LIMIT_REACHED',
      caseCount: cases.length,
      caseLimit: Math.min(100, policy.maxCanonicalCases),
    })
    if (selected) nextSpec.cases = [...cases, nextCase]
  } else {
    const affected = new Set(parseSubtaskIds(candidate.affectedSubtaskIds))
    for (const subtask of nextSpec.subtasks || []) {
      if (!affected.has(subtask.id)) continue
      const count = uniqueSubtaskCases(subtask).length
      const selected = count < OI_CANDIDATE_LIMITS.MAX_CASES_PER_SUBTASK
      decisions.push({
        subtaskId: subtask.id,
        selected,
        reason: selected ? 'capacity_available' : 'OI_SUBTASK_CASE_LIMIT_REACHED',
        caseCount: count,
        caseLimit: OI_CANDIDATE_LIMITS.MAX_CASES_PER_SUBTASK,
      })
      if (selected) {
        const gate = subtask.groups.find(group => group.kind === 'hack_gate')
        if (!gate) throw new Error(`Subtask ${subtask.id} 缺少 Hack Gate`)
        gate.cases = [...gate.cases, nextCase]
      }
    }
  }

  const selected = decisions.filter(item => item.selected)
  if (dryRun) return { promoted: false, reason: selected.length ? 'preview_selected' : 'preview_not_selected', decisions }
  if (!selected.length) {
    await prisma.$transaction(async tx => {
      await tx.testcaseCandidate.update({
        where: { id: candidate.id },
        data: {
          status: 'WAITING_REPLACEMENT',
          evaluationStage: 'waiting_replacement',
          selectionOutcome: { decisions },
          message: '当前 Evolving 测试点已满，Candidate 等待有足够证据的替换决策',
        },
      })
      if (candidate.hackAttemptId) {
        await updateTerminalHackAttempt(tx, {
          id: candidate.hackAttemptId,
          state: 'accepted',
          data: { canonicalStatus: 'pending', message: '技术 Hack 有效；Candidate 等待 Evolving 替换窗口' },
        })
      }
    })
    return { promoted: false, reason: 'capacity_reached', decisions }
  }

  const run = await prisma.canonicalSelectionRun.create({
    data: {
      id: crypto.randomUUID(),
      problemId: candidate.problemId,
      baseGraphHash: candidate.baseGraphHash!,
      corpusRevisionId: candidate.corpusRevisionId,
      policyRevision: policy.revision,
      status: 'running',
      mode: override ? 'emergency' : 'auto',
      baselineQuality: 0,
      candidateQuality: 1,
      qualityDelta: 1,
      selectedCandidateIds: [candidate.id],
      publishReason: override ? `管理员紧急发布：${override.reason}` : 'Candidate 通过选择约束，排队写入 Evolving',
    },
  })
  const claimed = await prisma.testcaseCandidate.updateMany({
    where: {
      id: candidate.id,
      status: candidate.status,
      baseSlot: 'EVOLVING',
      baseGraphHash: candidate.baseGraphHash,
      baseFencingToken: candidate.baseFencingToken,
    },
    data: {
      status: 'SELECTED',
      selectedAt: new Date(),
      evaluationStage: 'slot_writer_pending',
      selectionOutcome: { decisions },
    },
  })
  if (!claimed.count) {
    await prisma.canonicalSelectionRun.update({
      where: { id: run.id },
      data: { status: 'cancelled', errorCode: 'CANDIDATE_ALREADY_CLAIMED', finishedAt: new Date() },
    })
    return { promoted: false, reason: 'already_claimed' }
  }

  try {
    const writer = await replaceTestSetSlot({
      problemId: candidate.problemId,
      slot: 'EVOLVING',
      source: candidate.source === 'hack' ? 'hack' : 'contribution',
      sourceId: candidate.id,
      requestedBy: candidate.createdBy,
      baseConfigText: slot.judgeConfig,
      spec: nextSpec,
      expectedFencingToken: candidate.baseFencingToken,
    })
    if (writer.status === 'SUCCEEDED') {
      await finalizeSuccessfulWriter(candidate.id, writer.id, override ? 'emergency' : 'auto')
      const current = await prisma.problemTestSetSlot.findUnique({ where: { problemId_slot: { problemId: candidate.problemId, slot: 'EVOLVING' } } })
      return { promoted: true, graphHash: current?.graphHash, writerId: writer.id, decisions }
    }
    if (writer.status === 'FAILED' && writer.errorCode === 'TEST_SET_SLOT_FENCE_CONFLICT') {
      await prisma.canonicalSelectionRun.updateMany({ where: { id: run.id, status: 'running' }, data: { status: 'cancelled', errorCode: 'EVOLVING_FENCE_CONFLICT', finishedAt: new Date() } })
      await requeueStaleCandidate(candidate)
      return { promoted: false, reason: 'stale_requeued', writerId: writer.id, decisions }
    }
    return { promoted: false, reason: 'writer_pending', writerId: writer.id, decisions }
  } catch (error) {
    if (error instanceof TestSetSlotFenceConflict || (error as any)?.code === 'TEST_SET_SLOT_FENCE_CONFLICT') {
      await prisma.canonicalSelectionRun.updateMany({
        where: { id: run.id, status: 'running' },
        data: { status: 'cancelled', errorCode: 'EVOLVING_FENCE_CONFLICT', finishedAt: new Date() },
      })
      await requeueStaleCandidate(candidate)
      return { promoted: false, reason: 'stale_requeued', decisions }
    }
    await prisma.canonicalSelectionRun.updateMany({
      where: { id: run.id, status: 'running' },
      data: {
        status: 'failed',
        errorCode: 'EVOLVING_WRITE_FAILED',
        errorMessage: String((error as Error).message).slice(0, 2000),
        finishedAt: new Date(),
      },
    }).catch(() => undefined)
    await prisma.testcaseCandidate.updateMany({
      where: { id: candidate.id, status: 'SELECTED' },
      data: {
        status: 'ELIGIBLE',
        evaluationStage: 'writer_failed',
        message: String((error as Error).message).slice(0, 2000),
      },
    }).catch(() => undefined)
    throw error
  }
}

export async function emergencyPublishCandidate(input: { candidateId: string; userId: string; reason: string }) {
  const reason = input.reason.trim()
  if (reason.length < 10 || reason.length > 1000) {
    throw Object.assign(new Error('紧急发布必须填写 10～1000 字原因'), {
      statusCode: 422,
      code: 'EMERGENCY_PUBLISH_REASON_REQUIRED',
    })
  }
  return maybeAutoSelectCandidate(input.candidateId, { userId: input.userId, reason })
}

export async function previewCandidateSelection(candidateId: string) {
  return maybeAutoSelectCandidate(candidateId, undefined, { dryRun: true })
}
