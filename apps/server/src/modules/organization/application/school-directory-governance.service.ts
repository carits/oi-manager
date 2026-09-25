import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'
import { lockSchoolCreation, normalizeSchoolName, SchoolNameConflictError } from './school-creation.service'

export const SCHOOL_DIRECTORY_STATUSES = ['pending', 'verified', 'hidden', 'legacy'] as const
export type SchoolDirectoryStatus = typeof SCHOOL_DIRECTORY_STATUSES[number]

export class SchoolDirectoryGovernanceError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code: string) {
    super(message)
    this.name = 'SchoolDirectoryGovernanceError'
  }
}

export function classifyHistoricalSchool(schoolId: string): SchoolDirectoryStatus {
  if (schoolId.startsWith('school-test-') || schoolId.startsWith('school-temp-')) return 'legacy'
  if (schoolId === 'platform-school-00000000') return 'hidden'
  if (schoolId === 'school-default') return 'verified'
  return 'pending'
}

export function schoolStateHash(rows: Array<{ id: string; name: string; nameKey: string | null; directoryStatus: string; updatedAt: Date }>) {
  const state = rows
    .map(row => ({ id: row.id, name: row.name, nameKey: row.nameKey, directoryStatus: row.directoryStatus, updatedAt: row.updatedAt.toISOString() }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex')
}

export async function getSchoolReferenceSummary(organizationId: string, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const [Membership, Team, Contest, TrainingSession, Assignment, ProblemList, Problem, Submission, JoinApplications, Invitations] = await Promise.all([
    tx.organizationMembership.count({ where: { organizationId } }),
    tx.team.count({ where: { organizationId } }),
    tx.contest.count({ where: { organizationId } }),
    tx.trainingSession.count({ where: { organizationId } }),
    tx.assignment.count({ where: { organizationId } }),
    tx.problemList.count({ where: { organizationId } }),
    tx.problem.count({ where: { organizationId } }),
    tx.submission.count({ where: { organizationId } }),
    tx.organizationJoinApplication.count({ where: { organizationId } }),
    tx.organizationInvitation.count({ where: { organizationId } }),
  ])
  return {
    Membership,
    Team,
    Training: Contest + TrainingSession + Assignment,
    ProblemList,
    Problem,
    Submission,
    JoinApplications,
    Invitations,
  }
}

export async function getSchoolReferenceSummaries(organizationIds: string[]) {
  const summaries = new Map<string, Awaited<ReturnType<typeof getSchoolReferenceSummary>>>()
  for (const organizationId of organizationIds) {
    summaries.set(organizationId, await getSchoolReferenceSummary(organizationId))
  }
  return summaries
}

function validStatus(value: unknown): value is SchoolDirectoryStatus {
  return typeof value === 'string' && SCHOOL_DIRECTORY_STATUSES.includes(value as SchoolDirectoryStatus)
}

export async function updateSchoolDirectoryStatus(input: {
  organizationId: string
  actorUserId: string
  status: unknown
  reason: unknown
  expectedUpdatedAt: unknown
  confirmLegacy: unknown
}) {
  if (!validStatus(input.status)) throw new SchoolDirectoryGovernanceError(422, '目录状态无效', 'SCHOOL_DIRECTORY_STATUS_INVALID')
  const status = input.status
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 1000) : ''
  if (!reason) throw new SchoolDirectoryGovernanceError(422, '请填写状态变更原因', 'SCHOOL_DIRECTORY_REASON_REQUIRED')
  const expected = typeof input.expectedUpdatedAt === 'string' ? new Date(input.expectedUpdatedAt) : null
  if (!expected || Number.isNaN(expected.getTime())) throw new SchoolDirectoryGovernanceError(422, '缺少有效的并发版本', 'SCHOOL_DIRECTORY_VERSION_REQUIRED')

  try {
    return await prisma.$transaction(async tx => {
      await lockSchoolCreation(tx)
      const school = await tx.school.findFirst({ where: { organizationId: input.organizationId, Organization: { type: 'school' } } })
      if (!school) throw new SchoolDirectoryGovernanceError(404, '学校不存在', 'SCHOOL_NOT_FOUND')
      if (school.updatedAt.getTime() !== expected.getTime()) throw new SchoolDirectoryGovernanceError(409, '学校状态已被其他管理员修改，请刷新后重试', 'SCHOOL_DIRECTORY_STATUS_STALE')
      const from = school.directoryStatus as SchoolDirectoryStatus
      if (from === status) return { school, references: await getSchoolReferenceSummary(input.organizationId, tx) }
      if (from === 'legacy' && status !== 'pending') throw new SchoolDirectoryGovernanceError(409, '历史隔离学校必须先恢复为待核验', 'SCHOOL_DIRECTORY_TRANSITION_INVALID')
      if (status === 'legacy' && input.confirmLegacy !== true) throw new SchoolDirectoryGovernanceError(422, '隔离学校前必须确认影响范围', 'SCHOOL_DIRECTORY_LEGACY_CONFIRMATION_REQUIRED')

      let nameKey: string | null = school.nameKey
      if (status === 'legacy') nameKey = null
      if (from === 'legacy' && status === 'pending') {
        nameKey = normalizeSchoolName(school.name)
        const conflict = await tx.school.findFirst({ where: { nameKey, id: { not: school.id }, directoryStatus: { not: 'legacy' } }, select: { id: true } })
        if (conflict) throw new SchoolNameConflictError()
      }
      const references = await getSchoolReferenceSummary(input.organizationId, tx)
      const updated = await tx.school.update({ where: { id: school.id }, data: { directoryStatus: status, nameKey } })
      if (status === 'legacy') {
        const now = new Date()
        await tx.organizationJoinApplication.updateMany({ where: { organizationId: input.organizationId, status: 'pending' }, data: { status: 'cancelled', reviewedAt: now } })
        await tx.organizationInvitation.updateMany({ where: { organizationId: input.organizationId, status: 'pending' }, data: { status: 'revoked', respondedAt: now } })
        await tx.userNotification.updateMany({
          where: { organizationId: input.organizationId, readAt: null, sourceType: { in: ['organization_invitation', 'organization_join_application'] } },
          data: { readAt: now },
        })
      }
      await tx.platformAuditLog.create({ data: {
        id: crypto.randomUUID(), actorUserId: input.actorUserId, action: 'school_directory_status_changed',
        targetType: 'organization', targetId: input.organizationId,
        metadata: { from, to: status, reason, references },
      } })
      return { school: updated, references }
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (error instanceof SchoolNameConflictError) throw new SchoolDirectoryGovernanceError(409, error.message, 'SCHOOL_NAME_CONFLICT')
    throw error
  }
}
