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
   * @param schoolId 当前学校 ID
   * @param members  待导入成员列表
   */
  async checkConflicts(
    schoolId: string,
    members: MemberInput[]
  ): Promise<MemberValidateResult[]> {
    if (!members.length) return []

    // ── 批量查询，减少数据库调用 ──

    const usernames = members.map(m => m.username).filter(Boolean)

    // 批量查询 User 表（按用户名匹配），包含 Student 和 School
    const matchedUsers = await prisma.user.findMany({
      where: { username: { in: usernames } },
      include: {
        Student: {
          include: {
            School: { select: { name: true, educationSystem: true, schoolType: true } }
          }
        }
      }
    })
    const userMap = new Map(matchedUsers.map(u => [u.username, u]))

    // 批量查询 Student 表（按姓名 + 本校匹配）
    const names = [...new Set(members.map(m => m.studentName).filter(Boolean))]
    const matchedStudents = await prisma.student.findMany({
      where: {
        name: { in: names },
        schoolId
      },
      include: {
        School: { select: { name: true, educationSystem: true, schoolType: true } },
        User: { select: { username: true } }
      }
    })

    // 按姓名分组
    const studentByNameMap = new Map<string, typeof matchedStudents>()
    for (const s of matchedStudents) {
      const existing = studentByNameMap.get(s.name) || []
      existing.push(s)
      studentByNameMap.set(s.name, existing)
    }

    // ── 逐个检测冲突 ──
    const results: MemberValidateResult[] = []

    for (const member of members) {
      const conflicts: ConflictInfo[] = []

      // 检查 1：用户名冲突（本校 or 外校）
      const matchedUser = userMap.get(member.username)
      if (matchedUser) {
        const student = matchedUser.Student
        if (student && student.schoolId === schoolId) {
          // 本校用户名冲突
          const grade = this.calculateGrade(student)
          conflicts.push({
            type: 'username_same_school',
            message: `本校已有用户 "${member.username}"（${student.name}${grade ? '，' + grade : ''}）`,
            matchedStudentId: student.id,
            matchedStudentName: student.name,
            matchedStudentGrade: grade,
            matchedUsername: member.username
          })
        } else if (student) {
          // 外校用户名冲突
          const grade = this.calculateGrade(student)
          conflicts.push({
            type: 'username_diff_school',
            message: `外校已有用户 "${member.username}"（${student.name}${grade ? '，' + grade : ''}，${student.School?.name || '未知学校'}）`,
            matchedStudentId: student.id,
            matchedStudentName: student.name,
            matchedStudentGrade: grade,
            matchedSchoolName: student.School?.name,
            matchedUsername: member.username
          })
        } else if (matchedUser.role !== 'student') {
          // 用户名被教师/管理员占用
          conflicts.push({
            type: 'username_diff_school',
            message: `用户名 "${member.username}" 已被${matchedUser.role === 'teacher' ? '教师' : '管理员'}使用`,
            matchedUsername: member.username
          })
        }
      }

      // 检查 2：本校姓名冲突
      const sameNameStudents = studentByNameMap.get(member.studentName)
      if (sameNameStudents) {
        for (const s of sameNameStudents) {
          // 跳过已通过用户名冲突检测的同一学生（避免重复）
          if (conflicts.some(c => c.type === 'username_same_school' && c.matchedStudentId === s.id)) {
            continue
          }
          const grade = this.calculateGrade(s)
          conflicts.push({
            type: 'name_same_school',
            message: `本校已有学生 "${s.name}"${s.User ? `（用户名：${s.User.username}）` : ''}${grade ? '，' + grade : ''}`,
            matchedStudentId: s.id,
            matchedStudentName: s.name,
            matchedStudentGrade: grade,
            matchedUsername: s.User?.username
          })
        }
      }

      results.push({
        username: member.username,
        nickname: member.nickname,
        studentName: member.studentName,
        gender: member.gender,
        conflicts,
        status: conflicts.length > 0 ? 'conflict' : 'clear'
      })
    }

    return results
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
