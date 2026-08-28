import { prisma } from '../../../prisma'

export async function getGlobalPlatformStats() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const [totalSchools, totalTeachers, totalStudents, activeUsers, disabledUsers, recentRegistrations] = await Promise.all([
    prisma.organization.count({ where: { type: 'school', status: 'active' } }),
    prisma.organizationMembership.count({ where: { status: 'active', memberRole: { in: ['teacher', 'school_principal'] } } }),
    prisma.organizationMembership.count({ where: { status: 'active', memberRole: 'student' } }),
    prisma.user.count({ where: { status: 'active' } }),
    prisma.user.count({ where: { status: 'disabled' } }),
    prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
  ])
  return { totalSchools, totalTeachers, totalStudents, activeUsers, disabledUsers, recentRegistrations }
}

export async function getSchoolPlatformStats() {
  const organizations = await prisma.organization.findMany({
    where: { type: 'school' },
    include: {
      School: { select: { region: true, schoolType: true, status: true } },
      _count: {
        select: {
          Team: true,
          Membership: { where: { status: 'active', memberRole: { in: ['teacher', 'school_principal'] } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  const studentCounts = await prisma.organizationMembership.groupBy({
    by: ['organizationId'],
    where: { organizationId: { in: organizations.map(org => org.id) }, status: 'active', memberRole: 'student' },
    _count: { _all: true },
  })
  const studentsByOrganization = new Map(studentCounts.map(row => [row.organizationId, row._count._all]))
  return organizations.map(org => ({
    id: org.id,
    name: org.name,
    region: org.School?.region ?? null,
    schoolType: org.School?.schoolType ?? null,
    status: org.School?.status ?? org.status,
    teamCount: org._count.Team,
    teacherCount: org._count.Membership,
    studentCount: studentsByOrganization.get(org.id) ?? 0,
    createdAt: org.createdAt.toISOString(),
  }))
}
