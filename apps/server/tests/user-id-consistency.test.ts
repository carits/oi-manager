import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'

describe('current organization identity consistency', () => {
  it('every organization membership references an existing user and organization', async () => {
    const orphaned = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT m.id
      FROM "OrganizationMembership" m
      LEFT JOIN "User" u ON u.id = m."userId"
      LEFT JOIN "Organization" o ON o.id = m."organizationId"
      WHERE u.id IS NULL OR o.id IS NULL
    `
    expect(orphaned).toEqual([])
  })

  it('student and teacher profiles reference memberships with compatible roles', async () => {
    const invalidStudents = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT p.id
      FROM "OrganizationStudentProfile" p
      LEFT JOIN "OrganizationMembership" m ON m.id = p."membershipId"
      WHERE m.id IS NULL OR m."memberRole" <> 'student'
    `
    const invalidTeachers = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT p.id
      FROM "OrganizationTeacherProfile" p
      LEFT JOIN "OrganizationMembership" m ON m.id = p."membershipId"
      WHERE m.id IS NULL OR m."memberRole" NOT IN ('teacher', 'school_principal')
    `
    expect(invalidStudents).toEqual([])
    expect(invalidTeachers).toEqual([])
  })

  it('team members and join requests reference existing global users and teams', async () => {
    const invalidMembers = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT tm.id
      FROM "TeamMember" tm
      LEFT JOIN "User" u ON u.id = tm."userId"
      LEFT JOIN "Team" t ON t.id = tm."teamId"
      WHERE u.id IS NULL OR t.id IS NULL
    `
    const invalidRequests = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT r.id
      FROM "TeamJoinRequest" r
      LEFT JOIN "User" u ON u.id = r."userId"
      LEFT JOIN "Team" t ON t.id = r."teamId"
      WHERE u.id IS NULL OR t.id IS NULL
    `
    expect(invalidMembers).toEqual([])
    expect(invalidRequests).toEqual([])
  })

  it('legacy audit rows never point at missing teams or operators', async () => {
    const invalidLogs = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT l.id
      FROM "TeamOperationLog" l
      LEFT JOIN "User" u ON u.id = l."operatorId"
      LEFT JOIN "Team" t ON t.id = l."teamId"
      WHERE u.id IS NULL OR t.id IS NULL
    `
    expect(invalidLogs).toEqual([])
  })

  it('milestones reference student and teacher memberships in the same organization', async () => {
    const invalid = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT m.id
      FROM "Milestone" m
      LEFT JOIN "OrganizationMembership" student ON student.id = m."studentMembershipId"
      LEFT JOIN "OrganizationMembership" teacher ON teacher.id = m."teacherMembershipId"
      WHERE student.id IS NULL
        OR teacher.id IS NULL
        OR student."memberRole" <> 'student'
        OR teacher."memberRole" NOT IN ('teacher', 'school_principal')
        OR student."organizationId" <> teacher."organizationId"
    `
    expect(invalid).toEqual([])
  })

  it('team problem-list attribution references existing users', async () => {
    const invalid = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT item.id
      FROM "TeamProblemList" item
      LEFT JOIN "User" u ON u.id = item."addedBy"
      WHERE u.id IS NULL
    `
    expect(invalid).toEqual([])
  })
})
