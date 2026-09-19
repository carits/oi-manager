import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../src/prisma'

const LEGACY_ORGANIZATION_ROLES = ['student', 'teacher', 'school_principal'] as const
const ACCOUNT_ROLES = ['user', 'platform_admin', 'super_admin'] as const

async function main() {
  const unknownRoles = await prisma.user.groupBy({
    by: ['role'],
    where: { role: { notIn: [...ACCOUNT_ROLES, ...LEGACY_ORGANIZATION_ROLES] } },
    _count: { _all: true },
  })
  if (unknownRoles.length > 0) {
    throw new Error(`Refusing migration: unknown account roles ${JSON.stringify(unknownRoles)}`)
  }

  const rows = await prisma.user.findMany({
    where: { role: { in: [...LEGACY_ORGANIZATION_ROLES] } },
    select: {
      id: true,
      username: true,
      role: true,
      OrganizationMembership: {
        select: {
          id: true,
          organizationId: true,
          status: true,
          RoleAssignments: { select: { roleKey: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
  })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const snapshotDir = path.resolve('backups/internal-compat', timestamp)
  await fs.mkdir(snapshotDir, { recursive: true })
  await fs.writeFile(
    path.join(snapshotDir, 'legacy-account-roles.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), rows }, null, 2),
  )

  const byRole = Object.fromEntries(LEGACY_ORGANIZATION_ROLES.map(role => [
    role,
    rows.filter(row => row.role === role).length,
  ]))
  const membershipsMissingCanonicalRole = rows.filter(row =>
    row.OrganizationMembership.some(membership =>
      membership.status === 'active'
      && !membership.RoleAssignments.some(assignment =>
        LEGACY_ORGANIZATION_ROLES.includes(assignment.roleKey as typeof LEGACY_ORGANIZATION_ROLES[number]),
      ),
    ),
  )

  if (membershipsMissingCanonicalRole.length > 0) {
    throw new Error(
      `Refusing migration: ${membershipsMissingCanonicalRole.length} accounts have active memberships without a canonical organization role`,
    )
  }

  const { migrated, remaining } = await prisma.$transaction(async tx => {
    const result = await tx.user.updateMany({
      where: { role: { in: [...LEGACY_ORGANIZATION_ROLES] } },
      data: { role: 'user' },
    })
    const remaining = await tx.user.count({
      where: { role: { in: [...LEGACY_ORGANIZATION_ROLES] } },
    })
    if (remaining !== 0) throw new Error(`Legacy account roles remain after migration: ${remaining}`)
    return { migrated: result.count, remaining }
  })

  console.log(JSON.stringify({
    snapshotDir,
    inspected: rows.length,
    byRole,
    migrated,
    remaining,
  }, null, 2))
}

main()
  .finally(() => prisma.$disconnect())
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
