/**
 * VJudge 团队导入服务
 *
 * 职责：
 * 1. 获取 VJudge 团队列表
 * 2. 预览团队成员（原始数据，不做匹配）
 * 3. 校验成员冲突（调用通用 MemberMatchService）
 * 4. 执行导入（创建学生或发送邀请）
 */

import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'
import fs from 'fs'
import path from 'path'
import { prisma } from '../../prisma'
import logger from '../../lib/logger'
import { VJudgeSession } from '../platform-binding/binders/vjudge-session'
import { teamService } from '../team/team.service'
import { memberMatchService } from './member-match.service'
import type {
  VjudgeGroupPreview,
  VjudgeImportRequest,
  VjudgeImportResult,
  VjudgeImportDetail,
  MemberInput
} from './team-import.types'

export class VjudgeImportService {
  /**
   * 获取用户的 VJudge 会话
   * 策略：先用旧 Cookie → 不行再重登录
   */
  private async getSession(userId: string): Promise<VJudgeSession | null> {
    const binding = await prisma.userPlatformBinding.findUnique({
      where: {
        userId_platform: {
          userId,
          platform: 'vjudge'
        }
      }
    })

    if (!binding || binding.bindingStatus !== 'bound' || !binding.bindingData) {
      return null
    }

    try {
      const sessionData = JSON.parse(binding.bindingData)
      const session = new VJudgeSession()
      session.loadCookies(sessionData.cookies)
      return session
    } catch (err) {
      logger.error('vjudge_import_session_create_failed', err, { action: 'vjudge_import_getSession' })
      return null
    }
  }

  /**
   * 获取用户管理的 VJudge 团队列表
   * 策略：先用旧 Cookie → 不行再重登录 → 再不行提示用户重新绑定
   */
  async getGroups(userId: string) {
    const binding = await prisma.userPlatformBinding.findUnique({
      where: {
        userId_platform: {
          userId,
          platform: 'vjudge'
        }
      }
    })

    if (!binding || binding.bindingStatus !== 'bound' || !binding.bindingData) {
      throw new Error('请先绑定 VJudge 账号')
    }

    try {
      const sessionData = JSON.parse(binding.bindingData)

      // 策略1：用保存的会话 Cookie（过滤掉 Cloudflare Cookie 避免被拦截）
      logger.info('vjudge_import_session_cookies_attempt', { action: 'vjudge_import_getGroups' })
      const session = new VJudgeSession()

      // 过滤 Cloudflare 和分析 Cookie，只保留 VJudge 会话 Cookie
      const CLOUDFLARE_KEYS = ['cf_clearance', '__gads', '__gpi', '__eoi', 'FCCDCF', 'FCNEC', '_ga', '_ga_']
      session.loadCookiesFiltered(sessionData.cookies, CLOUDFLARE_KEYS)

      // 先访问首页建立连接（获取新的 Cloudflare Cookie）
      logger.info('vjudge_import_homepage_visit', { action: 'vjudge_import_getGroups' })
      try {
        await session.get('https://vjudge.net/')
      } catch (e) {
        logger.warn('vjudge_import_homepage_failed', { action: 'vjudge_import_getGroups', metadata: { detail: e instanceof Error ? e.message : String(e) } })
      }

      let groups = await session.getMyGroups()

      // 如果 Cookie 有效（拿到了团队），更新保存的 Cookie
      if (groups.length > 0) {
        logger.info('vjudge_import_groups_fetched', { action: 'vjudge_import_getGroups', metadata: { count: groups.length } })

        // 更新 Cookie（包括新的 Cloudflare Cookie）
        try {
          const newCookies = await session.saveCookies()
          const newBindingData = {
            ...sessionData,
            cookies: newCookies,
            verifiedAt: new Date().toISOString(),
          }
          await prisma.userPlatformBinding.update({
            where: { id: binding.id },
            data: { bindingData: JSON.stringify(newBindingData) }
          })
          logger.info('vjudge_import_cookies_updated', { action: 'vjudge_import_getGroups' })
        } catch (e) {
          logger.warn('vjudge_import_cookies_update_failed', { action: 'vjudge_import_getGroups', metadata: { detail: e instanceof Error ? e.message : String(e) } })
        }

        return groups
      }

      logger.info('vjudge_import_session_expired_relogin', { action: 'vjudge_import_getGroups' })

      // 策略2：会话过期，尝试用存储的密码重新登录
      if (sessionData.password) {
        const loginSession = new VJudgeSession()
        const loginResult = await loginSession.login(sessionData.username, sessionData.password)

        if (loginResult.success) {
          const newCookies = await loginSession.saveCookies()
          const newBindingData = {
            ...sessionData,
            cookies: newCookies,
            verifiedAt: new Date().toISOString(),
          }
          await prisma.userPlatformBinding.update({
            where: { id: binding.id },
            data: { bindingData: JSON.stringify(newBindingData) }
          })
          logger.info('vjudge_import_relogin_success', { action: 'vjudge_import_getGroups' })

          groups = await loginSession.getMyGroups()
          if (groups.length > 0) {
            return groups
          }
        } else {
          logger.warn('vjudge_import_relogin_failed', { action: 'vjudge_import_getGroups', metadata: { detail: loginResult.message } })
        }
      }

      // 两种策略都没拿到团队
      logger.warn('vjudge_import_all_strategies_failed', { action: 'vjudge_import_getGroups' })
      return groups
    } catch (err) {
      logger.error('vjudge_import_get_groups_failed', err, { action: 'vjudge_import_getGroups' })
      throw err
    }
  }

  /**
   * 预览 VJudge 团队（只返回原始成员列表，不做匹配）
   */
  async previewGroup(
    userId: string,
    shortName: string,
    options: {
      includeAnnouncement?: boolean
      includeDescription?: boolean
      includeMembers?: boolean
    }
  ): Promise<VjudgeGroupPreview> {
    const session = await this.getSession(userId)
    if (!session) {
      throw new Error('请先绑定 VJudge 账号')
    }

    const details = await session.getGroupDetails(shortName)
    if (!details) {
      throw new Error('获取团队详情失败，请检查团队是否存在')
    }

    const preview: VjudgeGroupPreview = {
      groupId: details.groupId,
      groupName: details.groupName,
      avatarUrl: details.avatarUrl || undefined
    }

    if (options.includeAnnouncement && details.announcement) {
      // VJudge 公告是纯文本，\n 换行需要转为 Markdown 段落分隔
      preview.announcement = details.announcement.replace(/\n/g, '\n\n')
    }

    if (options.includeDescription && details.groupDescription) {
      // VJudge 描述是纯文本，\n 换行需要转为 Markdown 段落分隔
      preview.groupDescription = details.groupDescription.replace(/\n/g, '\n\n')
    }

    if (options.includeMembers && details.members) {
      preview.members = details.members.map(m => ({
        username: m.username,
        nickname: m.nickname,
        studentName: m.nickname || m.username,
        gender: '男',
        status: 'new' as const,
        selected: true
      }))
    }

    return preview
  }

  /**
   * 校验成员冲突（调用通用匹配服务）
   */
  async validateMembers(
    organizationId: string,
    members: MemberInput[]
  ) {
    return memberMatchService.checkConflicts(organizationId, members)
  }

  /**
   * 下载 VJudge 团队头像到本地
   * 使用 VJudge session 的 Cookie 来访问需要认证的头像
   * @returns 本地可访问的相对路径，如 /uploads/public/avatars/team-xxx.png
   */
  private async downloadAvatar(avatarUrl: string, session?: VJudgeSession): Promise<string> {
    const uploadsDir = path.join(process.cwd(), 'uploads', 'public', 'avatars')
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true })
    }

    const ext = avatarUrl.match(/\.(png|jpg|jpeg|gif|webp|svg)/i)?.[1] || 'png'
    const filename = `team-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`
    const filePath = path.join(uploadsDir, filename)

    if (session) {
      // 使用 session 的 get 方法下载（带 Cookie）
      try {
        const buffer = await session.getBinary(avatarUrl)
        fs.writeFileSync(filePath, buffer)
        logger.info('vjudge_import_avatar_downloaded', { action: 'vjudge_import_downloadAvatar', metadata: { filename, size: buffer.length } })
        return `/uploads/public/avatars/${filename}`
      } catch (err) {
        logger.warn('vjudge_import_session_download_failed', { action: 'vjudge_import_downloadAvatar', metadata: { detail: err instanceof Error ? err.message : String(err) } })
      }
    }

    // 回退：直接 fetch（无 Cookie，可能被拦截）
    const response = await fetch(avatarUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      throw new Error(`下载头像失败: HTTP ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(filePath, buffer)

    return `/uploads/public/avatars/${filename}`
  }

  /**
   * 执行导入
   */
  async importMembers(
    userId: string,
    teacherId: string,
    organizationId: string,
    request: VjudgeImportRequest,
    user: any
  ): Promise<VjudgeImportResult> {
    const details: VjudgeImportDetail[] = []
    let createdCount = 0
    let invitedCount = 0
    let skippedCount = 0
    let errorCount = 0
    let teamId = request.teamId
    let teamName: string | undefined

    // 如果需要创建团队
    if (request.createTeam) {
      // 下载 VJudge 团队头像到本地（需要 VJudge 会话来通过认证）
      let localAvatarPath: string | null = null
      if (request.avatarUrl) {
        try {
          const session = await this.getSession(userId)
          localAvatarPath = await this.downloadAvatar(request.avatarUrl, session || undefined)
          logger.info('vjudge_import_avatar_saved', { action: 'vjudge_import_importMembers', metadata: { path: localAvatarPath } })
        } catch (err) {
          logger.warn('vjudge_import_avatar_download_failed', { action: 'vjudge_import_importMembers', metadata: { detail: err instanceof Error ? err.message : String(err) } })
          // 不回退到外部 URL（需要认证，前端无法直接加载）
          localAvatarPath = null
        }
      }

      const newTeam = await prisma.team.create({
        data: {
          id: request.teamId || request.vjudgeGroupId || `vjudge-${Date.now()}`,
          name: request.teamName || `VJudge导入团队-${Date.now()}`,
          organizationId,
          isPublic: request.visibility === 'public',
          announcement: request.announcement || null,
          description: request.description || null,
          avatar: localAvatarPath,
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
      if (team.organizationId !== organizationId) throw new Error('只能导入到本校团队')
      teamName = team.name
    }

    // 分离直接添加的学生和需要发送邀请的学生
    const directAddStudents: Array<{ id: string; type: 'student' }> = []
    const inviteStudents: Array<{ id: string; type: 'student' }> = []

    for (const member of request.members) {
      try {
        if (member.status === 'skip') {
          skippedCount++
          details.push({
            username: member.username,
            nickname: member.nickname,
            action: 'skipped'
          })
          continue
        }

        if (member.status === 'invite' && member.matchedStudentId) {
          // 向已存在学生发送邀请（pending 状态，不是直接加入）
          inviteStudents.push({ id: member.matchedStudentId, type: 'student' })
          invitedCount++
          details.push({
            username: member.username,
            nickname: member.nickname,
            action: 'invited',
            studentId: member.matchedStudentId,
            studentName: member.matchedStudentName
          })
        } else if (member.status === 'new' || member.status === 'existing') {
          // 创建新学生
          const studentName = member.studentName || member.nickname || member.username
          let systemUsername = member.username

          // 检查用户名冲突
          const existingUser = await prisma.user.findUnique({ where: { username: systemUsername } })
          if (existingUser) {
            systemUsername = `${member.username}_vj_${Date.now()}`
          }

          const tempPassword = Math.random().toString(36).substring(2, 10)
          const passwordHash = await bcrypt.hash(tempPassword, 10)

          const student = await prisma.$transaction(async (tx) => {
            const newUser = await tx.user.create({ data: { id: uuidv4(), username: systemUsername, passwordHash, role: "user", status: "active" } })
            const membership = await tx.organizationMembership.create({ data: { id: uuidv4(), organizationId, userId: newUser.id, memberRole: "student", relationType: "enrolled", status: "active", joinedAt: new Date() } })
            const headTeacher = await tx.organizationMembership.findFirst({ where: { organizationId, userId: teacherId, status: "active", memberRole: { in: ["teacher", "school_principal"] } }, select: { id: true } })
            const profile = await tx.organizationStudentProfile.create({ data: { id: uuidv4(), membershipId: membership.id, name: studentName, gender: member.gender || null, enrollmentYear: member.enrollmentYear || null, headTeacherMembershipId: headTeacher?.id || null } })
            return { id: newUser.id, profileId: profile.id }
          })

          // 绑定 VJudge 账号
          await prisma.userPlatformBinding.create({
            data: {
              id: uuidv4(),
              userId: student.id,
              platform: 'vjudge',
              platformUsername: member.username,
              bindingStatus: 'bound',
              verifiedAt: new Date()
            }
          }).catch(err => {
            logger.error('vjudge_import_platform_bind_failed', err, { action: 'vjudge_import_importMembers' })
          })

          directAddStudents.push({ id: student.id, type: 'student' })
          createdCount++
          details.push({
            username: member.username,
            nickname: member.nickname,
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
          nickname: member.nickname,
          action: 'error',
          error: err instanceof Error ? err.message : '处理失败'
        })
      }
    }

    // 新创建的学生直接加入团队（active 状态）
    if (teamId && directAddStudents.length > 0) {
      await teamService.addMembersDirectly(teamId, directAddStudents, 'member', user)
    }

    // 已存在的学生发送邀请（pending 状态，需学生端确认）
    if (teamId && inviteStudents.length > 0) {
      const uniqueInvites = [...new Map(inviteStudents.map(s => [s.id, s])).values()]
      const operatorId = user.userId

      for (const inv of uniqueInvites) {
        // 检查是否已是成员
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

export const vjudgeImportService = new VjudgeImportService()
