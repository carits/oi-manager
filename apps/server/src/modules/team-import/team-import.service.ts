import crypto from 'crypto'
/**
 * 团队导入模块 - 业务逻辑层
 * 调用现有的服务接口，不重复实现
 */

import { v4 as uuidv4 } from 'uuid'
import bcrypt from 'bcryptjs'
import { prisma } from '../../prisma'
import { teamService } from '../team/team.service'
import { teamRepository } from '../team/team.repository'
import { TeamImportRepository } from './team-import.repository'
import type {
  ImportPlatform,
  PlatformInfo,
  ParsedRow,
  MatchResult,
  MatchType,
  PreviewResponse,
  ConfirmImportRequest,
  ImportResult,
  ImportResultItem,
} from './team-import.types'

const importRepository = new TeamImportRepository()

export class TeamImportService {
  /**
   * 获取可导入的平台列表（含用户绑定状态）
   */
  async getAvailablePlatforms(userId: string): Promise<PlatformInfo[]> {
    const platforms: ImportPlatform[] = ['vjudge', 'luogu']
    const platformNames: Record<ImportPlatform, string> = {
      vjudge: 'VJudge',
      luogu: '洛谷',
    }

    const results: PlatformInfo[] = []

    for (const platform of platforms) {
      const binding = await prisma.userPlatformBinding.findUnique({
        where: {
          userId_platform: {
            userId,
            platform,
          },
        },
      })
      results.push({
        id: platform,
        name: platformNames[platform],
        supported: true,
        userBindingStatus: binding?.bindingStatus === 'bound' ? 'bound' : 'unbound',
        userBindingUsername: binding?.platformUsername || null,
      })
    }

    return results
  }

  /**
   * 获取用户管理的团队列表
   */
  async getUserTeams(teacherId: string, organizationId: string) {
    const adminMembers = await prisma.teamMember.findMany({
      where: {
        userId: teacherId,
        userType: 'teacher',
        role: { in: ['owner', 'admin'] },
        status: 'active',
        Team: { scope: 'campus', organizationId },
      },
      include: {
        Team: {
          include: {
            Organization: { include: { School: true } },
          },
        },
      },
    })

    return adminMembers.map((m) => ({
      id: m.Team.id,
      name: m.Team.name,
      organizationId: m.Team.organizationId,
      schoolName: m.Team.Organization?.School?.name,
    }))
  }

  /**
   * 解析原始输入数据
   */
  parseRawInput(rawData: string): ParsedRow[] {
    const lines = rawData.split('\n').filter((line) => line.trim())
    const results: ParsedRow[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      const lineNumber = i + 1

      if (!line) continue

      if (line.startsWith('#') || line.startsWith('//')) {
        continue
      }

      let username = ''
      let studentName: string | undefined

      if (line.includes(',')) {
        const parts = line.split(',').map((p) => p.trim())
        username = parts[0] || ''
        studentName = parts[1] || undefined
      } else if (line.includes('\t')) {
        const parts = line.split('\t').map((p) => p.trim())
        username = parts[0] || ''
        studentName = parts[1] || undefined
      } else if (line.includes(' ')) {
        const spaceIndex = line.indexOf(' ')
        username = line.substring(0, spaceIndex).trim()
        studentName = line.substring(spaceIndex + 1).trim() || undefined
      } else {
        username = line
      }

      const parsedUsername = this.cleanUsername(username)
      const candidateDisplayName = studentName || parsedUsername
      const valid = this.validateUsername(parsedUsername)

      results.push({
        lineNumber,
        rawUsername: username,
        rawStudentName: studentName,
        parsedUsername,
        candidateDisplayName,
        valid,
        error: valid ? undefined : '无效的平台用户名格式',
      })
    }

    return results
  }

  private cleanUsername(username: string): string {
    return username
      .trim()
      .replace(/^@+/, '')
      .replace(/\s+/g, '_')
      .toLowerCase()
  }

  private validateUsername(username: string): boolean {
    if (!username || username.length < 1 || username.length > 50) {
      return false
    }
    return /^[a-zA-Z0-9_.-]+$/.test(username)
  }

  /**
   * 创建导入批次
   */
  async createBatch(params: {
    operatorId: string
    organizationId: string
    platform: ImportPlatform
    createTeam: 'yes' | 'no'
    visibility?: 'public' | 'private'
    teamName?: string
    rawData: string
    user: any
  }): Promise<{ batchId: string; teamId: string | null; parsedRows: ParsedRow[] }> {
    const parsedRows = this.parseRawInput(params.rawData)
    const validRows = parsedRows.filter((r) => r.valid)

    let teamId: string | null = null

    // 如果需要创建团队，调用 teamService.createTeam
    if (params.createTeam === 'yes') {
      const platformNames: Record<ImportPlatform, string> = {
        vjudge: 'VJudge',
        luogu: '洛谷',
      }
      const teamName = params.teamName || `${platformNames[params.platform]}导入团队_${new Date().toLocaleDateString('zh-CN')}`

      const team = await teamService.createTeam({
        name: teamName,
        description: `从${platformNames[params.platform]}导入创建`,
        isPublic: params.visibility !== 'private',
      }, params.user)
      teamId = team.id as string
    }

    // 创建批次记录
    const batch = await prisma.teamMemberImportBatch.create({
      data: {
        id: crypto.randomUUID(),
        teamId: teamId || null,
        organizationId: params.organizationId,
        operatorId: params.operatorId,
        platform: params.platform,
        rawInput: params.rawData,
        totalCount: parsedRows.length,
        status: 'pending',
      },
    })

    // 执行匹配
    const matchResults = await this.matchRows(teamId, params.organizationId, params.platform, validRows)

    // 创建导入明细
    const data = parsedRows.map((row, index) => {
      const match = matchResults[index]
      return {
        id: uuidv4(),
        batchId: batch.id,
        lineNumber: row.lineNumber,
        rawUsername: row.rawUsername,
        rawStudentName: row.rawStudentName || null,
        parsedUsername: row.parsedUsername,
        candidateDisplayName: row.candidateDisplayName,
        matchType: match?.matchType || 'invalid',
        matchStatus: 'pending',
        matchedStudentProfileId: match?.matchedStudentProfileId || null,
        matchedStudentName: match?.matchedStudentName || null,
        action: match?.suggestedAction || null,
      }
    })

    await prisma.teamMemberImportItem.createMany({ data })

    return {
      batchId: batch.id,
      teamId,
      parsedRows,
    }
  }

  /**
   * 执行匹配
   */
  private async matchRows(
    teamId: string | null,
    organizationId: string,
    platform: string,
    rows: ParsedRow[]
  ): Promise<MatchResult[]> {
    const results: MatchResult[] = []

    for (const row of rows) {
      const result: MatchResult = {
        lineNumber: row.lineNumber,
        matchType: 'new_member',
        suggestedAction: 'create_and_invite',
        canAutoProcess: true,
      }

      if (row.rawStudentName) {
        const studentByName = await prisma.organizationStudentProfile.findFirst({
          where: {
            name: row.rawStudentName,
            status: "active",
            Membership: { organizationId, status: "active", memberRole: "student" },
          },
          include: { Membership: { select: { userId: true } } },
        })

        if (studentByName) {
          result.matchType = "same_name"
          result.matchedStudentProfileId = studentByName.id
          result.matchedStudentName = studentByName.name
          result.suggestedAction = "invite"
          result.canAutoProcess = false
          results.push(result)
          continue
        }
      }

      // 完全新成员
      result.matchType = 'new_member'
      result.suggestedAction = 'create_and_invite'
      result.canAutoProcess = true
      results.push(result)
    }

    return results
  }

  /**
   * 获取预览数据
   */
  async previewBatch(batchId: string, user: any): Promise<PreviewResponse> {
    const batch = await prisma.teamMemberImportBatch.findUnique({
      where: { id: batchId },
      include: {
        Team: {
          include: {
            Organization: { include: { School: true } },
          },
        },
      },
    })

    const batchOrganizationId = batch?.organizationId || batch?.Team?.organizationId || null
    if (!batch || !user?.organizationId || !batchOrganizationId || batchOrganizationId !== user.organizationId) {
      throw new Error('导入批次不存在')
    }

    const items = await prisma.teamMemberImportItem.findMany({
      where: { batchId },
      orderBy: { lineNumber: 'asc' },
    })

    const parsedRows: ParsedRow[] = items.map((item) => ({
      lineNumber: item.lineNumber,
      rawUsername: item.rawUsername,
      rawStudentName: item.rawStudentName || undefined,
      parsedUsername: item.parsedUsername || item.rawUsername,
      candidateDisplayName: item.candidateDisplayName || item.rawUsername,
      valid: item.matchType !== 'invalid',
    }))

    const matchResults: MatchResult[] = items.map((item) => ({
      lineNumber: item.lineNumber,
      matchType: item.matchType as MatchType,
      matchedStudentProfileId: item.matchedStudentProfileId || undefined,
      matchedStudentName: item.matchedStudentName || undefined,
      suggestedAction: this.getSuggestedAction(item.matchType),
      canAutoProcess: item.matchType !== 'conflict' && item.matchType !== 'invalid',
    }))

    const summary = {
      newMembers: items.filter((i) => i.matchType === 'new_member').length,
      existingMembers: items.filter((i) => i.matchType === 'existing_member').length,
      sameNameMatches: items.filter((i) => i.matchType === 'same_name').length,
      conflicts: items.filter((i) => i.matchType === 'conflict').length,
      invalidRows: items.filter((i) => i.matchType === 'invalid').length,
    }

    await prisma.teamMemberImportBatch.update({
      where: { id: batchId },
      data: { status: 'previewing' },
    })

    return {
      batchId,
      teamId: batch.teamId || '',
      platform: batch.platform as ImportPlatform,
      totalRows: items.length,
      parsedRows,
      matchResults,
      summary,
    }
  }

  private getSuggestedAction(matchType: string): MatchResult['suggestedAction'] {
    switch (matchType) {
      case 'existing_member':
        return 'link_only'
      case 'same_name':
        return 'invite'
      case 'conflict':
        return 'manual_required'
      case 'invalid':
        return 'skip'
      default:
        return 'create_and_invite'
    }
  }

  /**
   * 确认导入
   * 调用现有的服务接口
   */
  async confirmImport(
    params: ConfirmImportRequest,
    operatorId: string,
    user: any
  ): Promise<ImportResult> {
    const batch = await prisma.teamMemberImportBatch.findUnique({
      where: { id: params.batchId },
    })

    if (!batch || !user?.organizationId || !batch.organizationId || batch.organizationId !== user.organizationId) {
      throw new Error('导入批次不存在')
    }

    if (!batch.teamId) {
      throw new Error('未指定目标团队')
    }

    await prisma.teamMemberImportBatch.update({
      where: { id: params.batchId },
      data: { status: 'processing' },
    })

    const items = await prisma.teamMemberImportItem.findMany({
      where: { batchId: params.batchId },
    })

    const resultItems: ImportResultItem[] = []
    let invitedCount = 0
    let createdCount = 0
    let skippedCount = 0
    let errorCount = 0

    // 获取团队信息
    const team = await teamRepository.findById(batch.teamId)
    if (!team) {
      throw new Error('团队不存在')
    }
    if (!team.organizationId || team.scope === 'personal') {
      throw new Error('个人团队不支持校园成员导入')
    }
    const teamOrganizationId = team.organizationId

    const studentsToAdd: Array<{ id: string; type: 'student' }> = []

    for (const item of items) {
      const userChoice = params.items.find((i) => i.lineNumber === item.lineNumber)

      if (userChoice?.action === 'skip') {
        await prisma.teamMemberImportItem.update({
          where: { id: item.id },
          data: { matchStatus: 'skipped', processedAt: new Date() },
        })
        resultItems.push({
          lineNumber: item.lineNumber,
          rawUsername: item.rawUsername,
          matchType: item.matchType as MatchType,
          action: 'skip',
          result: 'skipped',
        })
        skippedCount++
        continue
      }

      try {
        if (item.matchType === 'same_name' && item.matchedStudentProfileId) {
          // 已有学生，直接加入团队
          const matchedProfile = await prisma.organizationStudentProfile.findUniqueOrThrow({ where: { id: item.matchedStudentProfileId }, select: { Membership: { select: { userId: true } } } })
          studentsToAdd.push({ id: matchedProfile.Membership.userId, type: 'student' })
          invitedCount++

          await prisma.teamMemberImportItem.update({
            where: { id: item.id },
            data: { matchStatus: 'invited', processedAt: new Date() },
          })
          resultItems.push({
            lineNumber: item.lineNumber,
            rawUsername: item.rawUsername,
            matchType: 'same_name',
            action: 'invite',
            result: 'success',
            studentId: matchedProfile.Membership.userId,
            studentName: item.matchedStudentName || undefined,
          })
        } else if (item.matchType === 'new_member') {
          // 创建新学生
          const studentName = userChoice?.studentName || item.candidateDisplayName || item.rawUsername

          // 生成用户名
          const tempUsername = `stu_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
          const tempPassword = Math.random().toString(36).substring(2, 10)
          const passwordHash = await bcrypt.hash(tempPassword, 10)

          // 创建学生（调用现有的创建逻辑）
          const student = await importRepository.createStudentWithUser({
            name: studentName,
            organizationId: teamOrganizationId!,
            username: tempUsername,
            passwordHash,
          })

          // 添加到团队
          studentsToAdd.push({ id: student.user.id, type: 'student' })
          createdCount++
          invitedCount++

          await prisma.teamMemberImportItem.update({
            where: { id: item.id },
            data: {
              matchStatus: 'created',
              createdStudentProfileId: student.student.id,
              processedAt: new Date(),
            },
          })
          resultItems.push({
            lineNumber: item.lineNumber,
            rawUsername: item.rawUsername,
            matchType: 'new_member',
            action: 'create_and_invite',
            result: 'success',
            studentId: student.user.id,
            studentName,
          })
        }
      } catch (err) {
        errorCount++
        await prisma.teamMemberImportItem.update({
          where: { id: item.id },
          data: {
            matchStatus: 'error',
            errorMessage: err instanceof Error ? err.message : '处理失败',
            processedAt: new Date(),
          },
        })
        resultItems.push({
          lineNumber: item.lineNumber,
          rawUsername: item.rawUsername,
          matchType: item.matchType as MatchType,
          action: 'error',
          result: 'error',
          errorMessage: err instanceof Error ? err.message : '处理失败',
        })
      }
    }

    // 批量添加成员到团队（直接批准，不需要学生确认）
    // 去重：同一个学生只添加一次
    if (studentsToAdd.length > 0) {
      const uniqueStudents = [...new Map(studentsToAdd.map(s => [s.id, s])).values()]
      await teamService.addMembersDirectly(batch.teamId, uniqueStudents, 'member', user)
    }

    // 更新批次统计
    await prisma.teamMemberImportBatch.update({
      where: { id: params.batchId },
      data: {
        successCount: invitedCount,
        skipCount: skippedCount,
        errorCount,
        status: 'completed',
        completedAt: new Date(),
      },
    })

    return {
      batchId: params.batchId,
      totalProcessed: items.length,
      invitedCount,
      createdCount,
      linkedCount: 0,
      skippedCount,
      errorCount,
      items: resultItems,
    }
  }

  /**
   * 获取导入结果
   */
  async getImportResult(batchId: string, user: any): Promise<ImportResult & { batch: any }> {
    const batch = await prisma.teamMemberImportBatch.findUnique({
      where: { id: batchId },
    })

    if (!batch || !user?.organizationId || !batch.organizationId || batch.organizationId !== user.organizationId) {
      throw new Error('导入批次不存在')
    }

    const items = await prisma.teamMemberImportItem.findMany({
      where: { batchId },
    })

    const resultItems: ImportResultItem[] = items.map((item) => ({
      lineNumber: item.lineNumber,
      rawUsername: item.rawUsername,
      matchType: item.matchType as MatchType,
      action: item.action || 'unknown',
      result:
        item.matchStatus === 'created' || item.matchStatus === 'invited'
          ? 'success'
          : item.matchStatus === 'skipped'
          ? 'skipped'
          : 'error',
      studentProfileId: item.createdStudentProfileId || item.matchedStudentProfileId || undefined,
      studentName: item.matchedStudentName || undefined,
      errorMessage: item.errorMessage || undefined,
    }))

    return {
      batchId,
      totalProcessed: items.length,
      invitedCount: batch.successCount,
      createdCount: items.filter((i) => i.matchStatus === 'created' && i.createdStudentProfileId).length,
      linkedCount: 0,
      skippedCount: batch.skipCount,
      errorCount: batch.errorCount,
      items: resultItems,
      batch,
    }
  }

  /**
   * 获取团队的导入历史
   */
  async getImportHistory(teamId: string, user: any) {
    const team = await teamService.assertTeamScope(teamId, user)
    if (!team.organizationId || !user?.organizationId || team.organizationId !== user.organizationId) {
      throw new Error('团队不存在')
    }
    return prisma.teamMemberImportBatch.findMany({
      where: { teamId, organizationId: user.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
  }
}
