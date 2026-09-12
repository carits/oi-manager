import crypto from 'node:crypto'
import { prisma } from '../../../prisma'
import { ORGANIZATION_BASE_ROLE_KEYS } from '../../authorization/membership-role-assignment'

const baseRoles = new Set<string>(ORGANIZATION_BASE_ROLE_KEYS)

async function state() {
  return prisma.organizationMembership.findMany({
    select: {
      id: true,
      organizationId: true,
      userId: true,
      memberRole: true,
      status: true,
      RoleAssignments: { select: { roleKey: true }, orderBy: { roleKey: 'asc' } },
    },
    orderBy: { id: 'asc' },
  })
}

function stateHash(rows: Awaited<ReturnType<typeof state>>) {
  return crypto.createHash('sha256').update(JSON.stringify(rows.map(row => ({
    id: row.id,
    memberRole: row.memberRole,
    status: row.status,
    roles: row.RoleAssignments.map(item => item.roleKey),
  })))).digest('hex')
}

export async function inspectMembershipRoleMigration() {
  const rows = await state()
  const missing = rows.filter(row => !row.RoleAssignments.some(role => role.roleKey === row.memberRole))
  const unsupported = rows.filter(row => !baseRoles.has(row.memberRole))
  const conflicting = rows.filter(row => row.RoleAssignments.some(role => baseRoles.has(role.roleKey) && role.roleKey !== row.memberRole))
  return {
    reportHash: stateHash(rows),
    totalMemberships: rows.length,
    normalizedMemberships: rows.length - new Set([...missing, ...unsupported, ...conflicting].map(row => row.id)).size,
    missingRoleAssignments: missing.length,
    conflictingBaseRoleAssignments: conflicting.length,
    unsupportedMemberRoles: unsupported.length,
    byLegacyRole: Object.fromEntries([...new Set(rows.map(row => row.memberRole))].sort().map(role => [
      role,
      rows.filter(row => row.memberRole === role).length,
    ])),
    samples: [...new Map([...unsupported, ...missing, ...conflicting].map(row => [row.id, row])).values()].slice(0, 20).map(row => ({
      membershipId: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      memberRole: row.memberRole,
      status: row.status,
    })),
  }
}

export async function applyMembershipRoleMigration(expectedReportHash: string, actorUserId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('membership-role-migration', 0)) IS NULL AS locked`
    // Re-read the public report inside the transaction so the hash also covers
    // membership status changes between check and apply.
    const fullRows = await tx.organizationMembership.findMany({
      select: { id: true, memberRole: true, status: true, RoleAssignments: { select: { roleKey: true }, orderBy: { roleKey: 'asc' } } },
      orderBy: { id: 'asc' },
    })
    const fullHash = crypto.createHash('sha256').update(JSON.stringify(fullRows.map(row => ({
      id: row.id, memberRole: row.memberRole, status: row.status,
      roles: row.RoleAssignments.map(item => item.roleKey),
    })))).digest('hex')
    if (!expectedReportHash || expectedReportHash !== fullHash) throw new Error('迁移检查结果已过期，请重新执行 check')
    const missing = fullRows.filter(row => !row.RoleAssignments.some(role => role.roleKey === row.memberRole))
    const unsupported = fullRows.filter(row => !baseRoles.has(row.memberRole))
    if (unsupported.length) throw new Error(`存在 ${unsupported.length} 条无法规范化的成员角色`)
    const affected = fullRows.filter(row => {
      const assignedBaseRoles = row.RoleAssignments.filter(role => baseRoles.has(role.roleKey)).map(role => role.roleKey)
      return assignedBaseRoles.length !== 1 || assignedBaseRoles[0] !== row.memberRole
    })
    if (affected.length) {
      await tx.organizationMembershipRole.deleteMany({
        where: { membershipId: { in: affected.map(row => row.id) }, roleKey: { in: [...ORGANIZATION_BASE_ROLE_KEYS] } },
      })
      await tx.organizationMembershipRole.createMany({
        data: affected.map(row => ({
          id: crypto.randomUUID(),
          membershipId: row.id,
          roleKey: row.memberRole,
          source: 'legacy_backfill',
          grantedBy: actorUserId,
        })),
        skipDuplicates: true,
      })
    }
    await tx.platformAuditLog.create({ data: {
      id: crypto.randomUUID(), actorUserId, action: 'membership_roles_backfilled', targetType: 'organization_membership',
      metadata: { reportHash: fullHash, normalized: affected.length, missing: missing.length, totalMemberships: fullRows.length },
    } })
    return { totalMemberships: fullRows.length, normalized: affected.length, missing: missing.length }
  }, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 60_000 })
}
