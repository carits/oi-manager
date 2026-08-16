/**
 * 通用成员匹配服务
 *
 * 所有平台导入（VJudge、洛谷等）共用此服务进行冲突检测。
 *
 * 检测三类冲突：
 * 1. 本校用户名冲突 — User.username 在本校学生中已存在
 * 2. 本校姓名冲突   — Student.name 在本校已存在
 * 3. 外校用户名冲突 — User.username 在外校学生中已存在
 */

import { prisma } from '../../prisma'
import type { ConflictInfo, MemberInput, MemberValidateResult } from './team-import.types'

export class MemberMatchService {
  /**
   * 批量检测成员冲突
   * @param organizationId 当前组织 ID
   * @param members  待导入成员列表
   */
  async checkConflicts(
    organizationId: string,
    members: MemberInput[]
  ): Promise<MemberValidateResult[]> {
    if (!members.length) return []
    const usernames = members.map(member => member.username).filter(Boolean)
    const names = [...new Set(members.map(member => member.studentName).filter(Boolean))]
    const [profiles, namedProfiles] = await Promise.all([
      prisma.organizationStudentProfile.findMany({
        where: { Membership: { organizationId, status: 'active', User: { username: { in: usernames } } } },
        include: { Membership: { include: { User: { select: { username: true } }, Organization: { include: { School: { select: { educationSystem: true, schoolType: true } } } } } } }
      }),
      prisma.organizationStudentProfile.findMany({
        where: { name: { in: names }, Membership: { organizationId, status: 'active' } },
        include: { Membership: { include: { User: { select: { username: true } }, Organization: { include: { School: { select: { educationSystem: true, schoolType: true } } } } } } }
      })
    ])
    const byUsername = new Map(profiles.map(profile => [profile.Membership.User.username, profile]))
    const byName = new Map<string, typeof namedProfiles>()
    for (const profile of namedProfiles) byName.set(profile.name, [...(byName.get(profile.name) || []), profile])

    return members.map(member => {
      const conflicts: ConflictInfo[] = []
      const sameUser = byUsername.get(member.username)
      if (sameUser) {
        const grade = this.calculateGrade({ enrollmentYear: sameUser.enrollmentYear, School: sameUser.Membership.Organization.School })
        conflicts.push({ type: 'username_same_school', message: '当前校园已有用户 "' + member.username + '"（' + sameUser.name + (grade ? '，' + grade : '') + '）', matchedStudentId: sameUser.Membership.userId, matchedStudentName: sameUser.name, matchedStudentGrade: grade, matchedUsername: member.username })
      }
      for (const profile of byName.get(member.studentName) || []) {
        if (profile.Membership.userId === sameUser?.Membership.userId) continue
        const grade = this.calculateGrade({ enrollmentYear: profile.enrollmentYear, School: profile.Membership.Organization.School })
        conflicts.push({ type: 'name_same_school', message: '当前校园已有学生 "' + profile.name + '"（用户名：' + profile.Membership.User.username + '）' + (grade ? '，' + grade : ''), matchedStudentId: profile.Membership.userId, matchedStudentName: profile.name, matchedStudentGrade: grade, matchedUsername: profile.Membership.User.username })
      }
      return { username: member.username, nickname: member.nickname, studentName: member.studentName, gender: member.gender, conflicts, status: conflicts.length ? 'conflict' : 'clear' }
    })
  }

  /**
   * 计算年级
   */
  private calculateGrade(student: {
    enrollmentYear: number | null
    School?: { educationSystem: string | null; schoolType: string | null } | null
  }): string {
    if (!student.enrollmentYear) return '未知'

    const currentYear = new Date().getFullYear()
    const currentMonth = new Date().getMonth() + 1
    const yearsSinceEnrollment = currentYear - student.enrollmentYear + (currentMonth >= 9 ? 0 : -1)

    const schoolType = student.School?.schoolType || ''

    if (schoolType.includes('初中')) {
      const grade = yearsSinceEnrollment + 1
      if (grade >= 1 && grade <= 3) return `初${['一', '二', '三'][grade - 1]}`
    }
    if (schoolType.includes('高中')) {
      const grade = yearsSinceEnrollment + 1
      if (grade >= 1 && grade <= 3) return `高${['一', '二', '三'][grade - 1]}`
    }

    return `${yearsSinceEnrollment + 1}年级`
  }
}

export const memberMatchService = new MemberMatchService()
