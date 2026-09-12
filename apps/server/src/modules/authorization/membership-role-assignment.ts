import type { Prisma } from '@prisma/client'
import crypto from 'node:crypto'

export const ORGANIZATION_BASE_ROLE_KEYS = ['student', 'teacher', 'school_principal'] as const
export type OrganizationBaseRoleKey = typeof ORGANIZATION_BASE_ROLE_KEYS[number]

function assertBaseRole(roleKey: string): asserts roleKey is OrganizationBaseRoleKey {
  if (!(ORGANIZATION_BASE_ROLE_KEYS as readonly string[]).includes(roleKey)) {
    throw new Error(`Unsupported organization base role: ${roleKey}`)
  }
}

/**
 * Keep the profile discriminator and the normalized authorization role in the
 * same transaction. Additive non-base roles and explicit capability grants are
 * intentionally preserved.
 */
export async function syncOrganizationMembershipBaseRole(
  tx: Prisma.TransactionClient,
  membershipId: string,
  roleKey: string,
  options: { source?: string; grantedBy?: string | null } = {},
) {
  assertBaseRole(roleKey)
  await tx.organizationMembershipRole.deleteMany({
    where: {
      membershipId,
      roleKey: { in: ORGANIZATION_BASE_ROLE_KEYS.filter(item => item !== roleKey) },
    },
  })
  await tx.organizationMembershipRole.createMany({
    data: [{
      id: crypto.randomUUID(),
      membershipId,
      roleKey,
      source: options.source || 'application',
      grantedBy: options.grantedBy || null,
    }],
    skipDuplicates: true,
  })
}
