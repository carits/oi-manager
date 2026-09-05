import crypto from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../../prisma'
import { lockSchoolCreation, normalizeSchoolName } from '../../organization/application/school-creation.service'
import { classifyHistoricalSchool, schoolStateHash, type SchoolDirectoryStatus } from '../../organization/application/school-directory-governance.service'

type Db = Prisma.TransactionClient | typeof prisma

async function loadState(db: Db) {
  return db.school.findMany({
    select: { id: true, name: true, nameKey: true, directoryStatus: true, organizationId: true, createdAt: true, updatedAt: true },
    orderBy: { id: 'asc' },
  })
}

async function referenceTotals(db: Db, organizationIds: string[]) {
  if (!organizationIds.length) return { memberships: 0, studentProfiles: 0, teacherProfiles: 0, teams: 0, trainings: 0, problemLists: 0, problems: 0, submissions: 0, joinApplications: 0, invitations: 0 }
  const membershipWhere = { organizationId: { in: organizationIds } }
  const [memberships, studentProfiles, teacherProfiles, teams, trainings, problemLists, problems, submissions, joinApplications, invitations] = await Promise.all([
    db.organizationMembership.count({ where: membershipWhere }),
    db.organizationStudentProfile.count({ where: { Membership: membershipWhere } }),
    db.organizationTeacherProfile.count({ where: { Membership: membershipWhere } }),
    db.team.count({ where: { organizationId: { in: organizationIds } } }),
    db.training.count({ where: { organizationId: { in: organizationIds } } }),
    db.problemList.count({ where: { organizationId: { in: organizationIds } } }),
    db.problem.count({ where: { organizationId: { in: organizationIds } } }),
    db.submission.count({ where: { organizationId: { in: organizationIds } } }),
    db.organizationJoinApplication.count({ where: { organizationId: { in: organizationIds } } }),
    db.organizationInvitation.count({ where: { organizationId: { in: organizationIds } } }),
  ])
  return { memberships, studentProfiles, teacherProfiles, teams, trainings, problemLists, problems, submissions, joinApplications, invitations }
}

function collisionReport(rows: Awaited<ReturnType<typeof loadState>>) {
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    if (classifyHistoricalSchool(row.id) === 'legacy') continue
    const key = normalizeSchoolName(row.name)
    groups.set(key, [...(groups.get(key) || []), row])
  }
  return [...groups.entries()].filter(([, schools]) => schools.length > 1).map(([nameKey, schools]) => ({
    nameKey,
    schools: schools.map(school => ({ id: school.id, name: school.name, organizationId: school.organizationId })),
  }))
}

export async function inspectSchoolDirectoryStatusMigration() {
  const rows = await loadState(prisma)
  const proposed = new Map<SchoolDirectoryStatus, typeof rows>([['pending', []], ['verified', []], ['hidden', []], ['legacy', []]])
  for (const row of rows) proposed.get(classifyHistoricalSchool(row.id))!.push(row)
  const legacyOrganizationIds = proposed.get('legacy')!.map(row => row.organizationId).filter((id): id is string => Boolean(id))
  const collisions = collisionReport(rows)
  return {
    reportHash: schoolStateHash(rows), total: rows.length,
    proposed: Object.fromEntries([...proposed.entries()].map(([status, schools]) => [status, { count: schools.length, samples: schools.slice(0, 10).map(school => ({ id: school.id, name: school.name, organizationId: school.organizationId, createdAt: school.createdAt })) }])),
    collisionGroupCount: collisions.length,
    collisions: collisions.slice(0, 20),
    collisionGroupsOmitted: Math.max(0, collisions.length - 20),
    legacyReferences: await referenceTotals(prisma, legacyOrganizationIds),
  }
}

export async function applySchoolDirectoryStatusMigration(expectedReportHash: string, actorUserId: string) {
  return prisma.$transaction(async tx => {
    await lockSchoolCreation(tx)
    const rows = await loadState(tx)
    const currentHash = schoolStateHash(rows)
    if (!expectedReportHash || expectedReportHash !== currentHash) throw new Error('迁移检查结果已过期，请重新执行 check')
    const collisions = collisionReport(rows)
    if (collisions.length) throw new Error('非隔离学校仍存在标准化重名，本次未修改任何记录')

    const changed = { pending: 0, verified: 0, hidden: 0, legacy: 0 }
    const legacyRows = rows.filter(row => classifyHistoricalSchool(row.id) === 'legacy')
    for (const row of rows) {
      const status = classifyHistoricalSchool(row.id)
      const nameKey = status === 'legacy' ? null : normalizeSchoolName(row.name)
      if (row.directoryStatus === status && row.nameKey === nameKey) continue
      changed[status] += 1
    }
    if (changed.legacy) {
      await tx.school.updateMany({ where: { id: { in: legacyRows.map(row => row.id) } }, data: { directoryStatus: 'legacy', nameKey: null } })
    }
    for (const row of rows.filter(row => classifyHistoricalSchool(row.id) !== 'legacy')) {
      const status = classifyHistoricalSchool(row.id)
      const nameKey = normalizeSchoolName(row.name)
      if (row.directoryStatus === status && row.nameKey === nameKey) continue
      await tx.school.update({ where: { id: row.id }, data: { directoryStatus: status, nameKey } })
    }
    const now = new Date()
    const legacyOrganizationIds = rows.filter(row => classifyHistoricalSchool(row.id) === 'legacy').map(row => row.organizationId).filter((id): id is string => Boolean(id))
    const [cancelledApplications, revokedInvitations, readNotifications] = await Promise.all([
      tx.organizationJoinApplication.updateMany({ where: { organizationId: { in: legacyOrganizationIds }, status: 'pending' }, data: { status: 'cancelled', reviewedAt: now } }),
      tx.organizationInvitation.updateMany({ where: { organizationId: { in: legacyOrganizationIds }, status: 'pending' }, data: { status: 'revoked', respondedAt: now } }),
      tx.userNotification.updateMany({ where: { organizationId: { in: legacyOrganizationIds }, readAt: null, sourceType: { in: ['organization_invitation', 'organization_join_application'] } }, data: { readAt: now } }),
    ])
    const references = await referenceTotals(tx, legacyOrganizationIds)
    await tx.platformAuditLog.create({ data: {
      id: crypto.randomUUID(), actorUserId, action: 'school_directory_status_migration_applied', targetType: 'school_directory',
      metadata: { reportHash: currentHash, changed, legacyCount: legacyOrganizationIds.length, references, cancelledApplications: cancelledApplications.count, revokedInvitations: revokedInvitations.count, readNotifications: readNotifications.count },
    } })
    return { total: rows.length, changed, legacyCount: legacyOrganizationIds.length, references, cancelledApplications: cancelledApplications.count, revokedInvitations: revokedInvitations.count, readNotifications: readNotifications.count }
  }, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 60_000 })
}
