import crypto from 'crypto'
import type { Prisma } from '@prisma/client'

const SCHOOL_CREATION_LOCK = 7832357088731n

export class SchoolNameConflictError extends Error {
  constructor() {
    super('已存在同名学校，请使用完整正式名称')
    this.name = 'SchoolNameConflictError'
  }
}

export function normalizeSchoolName(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
}

export type SchoolCreationInput = {
  name: string
  shortName?: string | null
  region?: string | null
  schoolType?: string | null
  schoolNature?: string | null
  educationSystem?: string | null
  contactPerson?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  description?: string | null
  principalName: string
  principalTitle?: string | null
}

type ExistingPrincipal = { type: 'existing'; userId: string }
type NewPrincipal = { type: 'new'; userId: string; username: string; passwordHash: string }

export async function lockSchoolCreation(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCHOOL_CREATION_LOCK})`
}

export async function createSchoolOrganizationCore(
  tx: Prisma.TransactionClient,
  input: SchoolCreationInput,
  principal: ExistingPrincipal | NewPrincipal,
) {
  await lockSchoolCreation(tx)
  const nameKey = normalizeSchoolName(input.name)
  if (!nameKey || await tx.school.findUnique({ where: { nameKey }, select: { id: true } })) {
    throw new SchoolNameConflictError()
  }

  const organizationId = crypto.randomUUID()
  const membershipId = crypto.randomUUID()
  await tx.organization.create({
    data: { id: organizationId, name: input.name.trim(), type: 'school', status: 'active', joinPolicy: 'invite_only', description: input.description || null },
  })
  if (principal.type === 'new') {
    await tx.user.create({
      data: { id: principal.userId, username: principal.username, passwordHash: principal.passwordHash, role: 'user' },
    })
  }
  await tx.organizationMembership.create({
    data: { id: membershipId, organizationId, userId: principal.userId, memberRole: 'school_principal', relationType: 'employee', status: 'active', joinedAt: new Date() },
  })
  await tx.organizationTeacherProfile.create({
    data: {
      id: crypto.randomUUID(), membershipId, name: input.principalName,
      title: input.principalTitle || null, email: input.contactEmail || null, phone: input.contactPhone || null,
    },
  })
  const school = await tx.school.create({
    data: {
      id: crypto.randomUUID(), name: input.name.trim(), nameKey, shortName: input.shortName || null,
      description: input.description || null, organizationId, currentPrincipalMembershipId: membershipId,
      region: input.region || null, schoolType: input.schoolType || null, schoolNature: input.schoolNature || null,
      educationSystem: input.educationSystem || '6-3-3', contactPerson: input.contactPerson || null,
      contactPhone: input.contactPhone || null, contactEmail: input.contactEmail || null,
    },
  })
  return { organizationId, membershipId, schoolId: school.id, userId: principal.userId, nameKey }
}
