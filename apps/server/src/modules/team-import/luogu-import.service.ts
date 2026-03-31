/**
 * 洛谷团队导入服务
 *
 * 职责：
 * 1. 获取洛谷团队列表
 * 2. 预览团队成员
 * 3. 执行导入（创建学生或发送邀请）
 *
 * 校验使用共享的 memberMatchService.checkConflicts()
 */

import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'
import { prisma } from '../../prisma'
import { LuoguSession } from '../platform-binding/binders/luogu-session'
import { teamService } from '../team/team.service'
import type {
  LuoguGroupPreview,
  LuoguImportRequest,
  LuoguImportResult,
  LuoguImportDetail,
  LuoguMemberInput,
} from './team-import.types'

export class LuoguImportService {
  /**
   * 获取用户绑定的洛谷会话
   */
  private async getSession(userId: string): Promise<LuoguSession | null> {
    return LuoguSession.fromBinding(userId)
  }

  /**
   * 获取用户管理的洛谷团队列表
   */
  async getGroups(userId: string) {
    const session = await this.getSession(userId)
    if (!session) {
      throw new Error('请先绑定洛谷账号')
    }
    return session.getMyGroups()
  }

  /**
   * 预览洛谷团队（公告 + 成员）
   */
  async previewGroup(
    userId: string,
    teamId: string,
    options: {
      includeAnnouncement?: boolean
      includeMembers?: boolean
    }
  ): Promise<LuoguGroupPreview> {
    const session = await this.getSession(userId)
    if (!session) {
      throw new Error('请先绑定洛谷账号')
    }

    const details = await session.getGroupDetails(teamId)
    if (!details) {
      throw new Error('获取团队详情失败，请检查团队是否存在')
    }

    const preview: LuoguGroupPreview = {
      groupId: details.groupId,
      groupName: details.groupName,
    }

    if (options.includeAnnouncement && details.announcement) {
      preview.announcement = details.announcement
    }

    if (options.includeMembers) {
      preview.members = details.members.map(m => ({
        username: m.username,
        nickname: '',
        studentName: m.realName || m.username,
        gender: '男',
        status: 'new' as const,
        selected: true,
      }))
    }

    return preview
  }

  /**
   * 执行导入
   */
  async importMembers(
    userId: string,
    teacherId: string,
    schoolId: string,
    request: LuoguImportRequest,
    user: any
  ): Promise<LuoguImportResult> {
    const details: LuoguImportDetail[] = []
    let createdCount = 0
    let invitedCount = 0
    let skippedCount = 0
    let errorCount = 0
    let teamId = request.teamId
    let teamName: string | undefined

    // 如果需要创建团队
    if (request.createTeam && !request.teamId) {
      const newTeam = await prisma.team.create({
        data: {
          id: uuidv4(),
          name: request.teamName || `洛谷导入团队-${Date.now()}`,
          schoolId,
          isPublic: request.visibility === 'public',
          announcement: request.announcement || null,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      })
      teamId = newTeam.id
      teamName = newTeam.name

      await prisma.teamMember.create({
        data: {
          id: uuidv4(),
          teamId: teamId!,
          userId: teacherId,
          userType: 'teacher',
          role: 'owner',
          status: 'active',
          joinedAt: new Date()
        }
      })
    } else if (request.teamId) {
      const team = await prisma.team.findUnique({ where: { id: request.teamId } })
      if (!team) throw new Error('团队不存在')
      if (team.schoolId !== schoolId) throw new Error('只能导入到本校团队')
      teamName = team.name
    }

    // 分离直接添加和邀请的学生
    const directAddStudents: Array<{ id: string; type: 'student' }> = []
    const inviteStudents: Array<{ id: string; type: 'student' }> = []

    for (const member of request.members) {
      try {
        if (member.status === 'skip') {
          skippedCount++
          details.push({
            username: member.username,
            nickname: member.nickname || '',
            action: 'skipped'
          })
          continue
        }

        if (member.status === 'invite' && member.matchedStudentId) {
          inviteStudents.push({ id: member.matchedStudentId, type: 'student' })
          invitedCount++
          details.push({
            username: member.username,
            nickname: member.nickname || '',
            action: 'invited',
            studentId: member.matchedStudentId,
            studentName: member.matchedStudentName
          })
        } else if (member.status === 'new' || member.status === 'existing') {
          const studentName = member.studentName || member.username
          let systemUsername = member.username

          // 检查用户名冲突
          const existingUser = await prisma.user.findUnique({ where: { username: systemUsername } })
          if (existingUser) {
            systemUsername = `${member.username}_lg_${Date.now()}`
          }

          const tempPassword = Math.random().toString(36).substring(2, 10)
          const passwordHash = await bcrypt.hash(tempPassword, 10)

          const student = await prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({
              data: {
                id: uuidv4(),
                username: systemUsername,
                passwordHash,
                role: 'student',
                status: 'active'
              }
            })

            return tx.student.create({
              data: {
                id: uuidv4(),
                userId: newUser.id,
                name: studentName,
                gender: member.gender || null,
                schoolId,
                enrollmentYear: member.enrollmentYear || null,
                headTeacherId: teacherId
              }
            })
          })

          // 绑定洛谷账号
          await prisma.userPlatformBinding.create({
            data: {
              id: uuidv4(),
              userId: student.userId,
              platform: 'luogu',
              platformUsername: member.username,
              bindingStatus: 'bound',
              verifiedAt: new Date()
            }
          }).catch(err => {
            console.error('[LuoguImport] Failed to bind platform:', err)
          })

          directAddStudents.push({ id: student.id, type: 'student' })
          createdCount++
          details.push({
            username: member.username,
            nickname: member.nickname || '',
            action: 'created',
            studentId: student.id,
            studentName,
            systemUsername,
            tempPassword
          })
        }
      } catch (err) {
        errorCount++
        details.push({
          username: member.username,
          nickname: member.nickname || '',
          action: 'error',
          error: err instanceof Error ? err.message : '处理失败'
        })
      }
    }

    // 新创建的学生直接加入团队
    if (teamId && directAddStudents.length > 0) {
      await teamService.addMembersDirectly(teamId, directAddStudents, 'member', user)
    }

    // 已存在的学生发送邀请
    if (teamId && inviteStudents.length > 0) {
      const uniqueInvites = [...new Map(inviteStudents.map(s => [s.id, s])).values()]
      const operatorId = user.teacherId || user.studentId || ''

      for (const inv of uniqueInvites) {
        const existing = await prisma.teamMember.findFirst({
          where: { teamId, userId: inv.id, userType: 'student' }
        })
        if (existing) continue

        await prisma.teamMember.create({
          data: {
            id: uuidv4(),
            teamId,
            userId: inv.id,
            userType: 'student',
            role: 'member',
            status: 'pending',
            invitedBy: operatorId,
            joinedAt: new Date()
          }
        })
      }
    }

    return {
      success: true,
      message: `导入完成：创建 ${createdCount} 人，邀请 ${invitedCount} 人，跳过 ${skippedCount} 人，失败 ${errorCount} 人`,
      createdCount,
      invitedCount,
      skippedCount,
      errorCount,
      details,
      teamId,
      teamName
    }
  }
}

export const luoguImportService = new LuoguImportService()
