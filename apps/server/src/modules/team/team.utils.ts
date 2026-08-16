/** 团队成员展示工具：校园团队仅从组织成员档案读取，个人团队仅从全局账号读取。 */
import { prisma } from '../../prisma'
import type { MemberType, MemberDetails, TeamScope } from './team.types'

async function campusDetails(
  userIds: string[],
  type: Extract<MemberType, 'teacher' | 'student'>,
  organizationId?: string
): Promise<Map<string, MemberDetails>> {
  const result = new Map<string, MemberDetails>()
  if (!organizationId || userIds.length === 0) return result

  if (type === 'teacher') {
    const profiles = await prisma.organizationTeacherProfile.findMany({
      where: { Membership: { organizationId, userId: { in: userIds }, status: 'active' } },
      select: { name: true, avatar: true, title: true, Membership: { select: { userId: true, User: { select: { username: true, avatar: true, status: true } } } } }
    })
    for (const profile of profiles) {
      if (profile.Membership.User.status !== 'active') continue
      result.set(profile.Membership.userId, {
        id: profile.Membership.userId,
        name: profile.name,
        username: profile.Membership.User.username,
        avatar: profile.Membership.User.avatar || profile.avatar,
        type: 'teacher',
        title: profile.title || undefined
      })
    }
    return result
  }

  const profiles = await prisma.organizationStudentProfile.findMany({
    where: { Membership: { organizationId, userId: { in: userIds }, status: 'active' } },
    select: { name: true, avatar: true, rating: true, enrollmentYear: true, Membership: { select: { userId: true, User: { select: { username: true, avatar: true, status: true } } } } }
  })
  for (const profile of profiles) {
    if (profile.Membership.User.status !== 'active') continue
    result.set(profile.Membership.userId, {
      id: profile.Membership.userId,
      name: profile.name,
      username: profile.Membership.User.username,
      avatar: profile.Membership.User.avatar || profile.avatar,
      type: 'student',
      rating: profile.rating || undefined,
      enrollmentYear: profile.enrollmentYear || undefined
    })
  }
  return result
}

export async function getUserName(userId: string, userType: MemberType, organizationId?: string): Promise<string> {
  const detail = await getMemberDetails(userId, userType, organizationId)
  return detail?.name || '未知'
}

export async function getUserNames(userIds: string[], userType: MemberType, organizationId?: string): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  if (userType === 'user') {
    const users = await prisma.user.findMany({ where: { id: { in: userIds }, status: 'active' }, select: { id: true, username: true } })
    return new Map(users.map((user) => [user.id, user.username]))
  }
  const details = await campusDetails(userIds, userType, organizationId)
  return new Map([...details.entries()].map(([id, detail]) => [id, detail.name]))
}

export async function getMemberDetails(userId: string, userType: MemberType, organizationId?: string): Promise<MemberDetails | null> {
  if (userType === 'user') {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, avatar: true, status: true } })
    return !user || user.status !== 'active' ? null : { id: user.id, name: user.username, username: user.username, avatar: user.avatar, type: 'user' }
  }
  return (await campusDetails([userId], userType, organizationId)).get(userId) || null
}

export async function getMemberDetailsBatch(
  members: Array<{ userId: string; userType: MemberType }>,
  organizationId?: string
): Promise<Map<string, MemberDetails>> {
  const result = new Map<string, MemberDetails>()
  const add = (type: MemberType, details: Map<string, MemberDetails>) => details.forEach((detail, id) => result.set(`${type}:${id}`, detail))
  const userIds = [...new Set(members.filter((m) => m.userType === 'user').map((m) => m.userId))]
  const teacherIds = [...new Set(members.filter((m) => m.userType === 'teacher').map((m) => m.userId))]
  const studentIds = [...new Set(members.filter((m) => m.userType === 'student').map((m) => m.userId))]
  if (userIds.length) {
    const users = await prisma.user.findMany({ where: { id: { in: userIds }, status: 'active' }, select: { id: true, username: true, avatar: true } })
    add('user', new Map(users.map((u) => [u.id, { id: u.id, name: u.username, username: u.username, avatar: u.avatar, type: 'user' as const }])))
  }
  add('teacher', await campusDetails(teacherIds, 'teacher', organizationId))
  add('student', await campusDetails(studentIds, 'student', organizationId))
  return result
}

export async function getUserDisplayName(userId: string, userType: MemberType, scope: TeamScope, organizationId?: string): Promise<string> {
  return scope === 'personal' ? (await getMemberDetails(userId, 'user'))?.username || '未知' : getUserName(userId, userType, organizationId)
}

export function formatMemberForScope<T extends MemberDetails>(member: T, scope: TeamScope): T {
  return scope === 'personal' ? { ...member, name: member.username || member.name } : member
}

export function formatTeamLimitMessage(isTeacher: boolean): string { return `您创建的团队数量已达上限（${isTeacher ? 50 : 5}个）` }
export function formatNewOwnerLimitMessage(isTeacher: boolean): string { return `该${isTeacher ? '教师' : '学生'}创建的团队数量已达上限（${isTeacher ? 50 : 5}个），无法转移` }


const FIELD_MAPPINGS: Record<string, string> = { School: 'school', Organization: 'organization', TeamMember: 'members', User: 'user' }
export function transformTeamForFrontend(team: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(team)) {
    if (key === 'Organization' && !team.School && value && typeof value === 'object') result.school = value
    if (team.scope === 'personal' && (key === 'organizationId' || key === 'Organization')) continue
    result[FIELD_MAPPINGS[key] || key] = value
  }
  return result
}
export function transformTeamsForFrontend(teams: Array<Record<string, unknown>>): Array<Record<string, unknown>> { return teams.map(transformTeamForFrontend) }
