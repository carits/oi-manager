import crypto from 'node:crypto'
import { prisma } from '../../../prisma'

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
  return {
    reportHash: stateHash(rows),
    totalMemberships: rows.length,
    normalizedMemberships: rows.length - missing.length,
    missingRoleAssignments: missing.length,
    byLegacyRole: Object.fromEntries([...new Set(rows.map(row => row.memberRole))].sort().map(role => [
      role,
      rows.filter(row => row.memberRole === role).length,
    ])),
    samples: missing.slice(0, 20).map(row => ({
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
    if (missing.length) {
      await tx.organizationMembershipRole.createMany({
        data: missing.map(row => ({
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
      metadata: { reportHash: fullHash, created: missing.length, totalMemberships: fullRows.length },
    } })
    return { totalMemberships: fullRows.length, created: missing.length }
  }, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 60_000 })
}
