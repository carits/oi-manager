/**
 * 团队导入模块 - 数据访问层
 */

import { v4 as uuidv4 } from 'uuid'
import { prisma } from '../../prisma'
import type { ImportPlatform, ParsedRow, MatchResult } from './team-import.types'

export class TeamImportRepository {
  /**
   * 创建团队
   */
  async createTeam(params: {
    name: string
    schoolId: string
    leaderId: string
    isPublic: boolean
  }) {
    return prisma.$transaction(async (tx) => {
      // 创建团队
      const team = await tx.team.create({
        data: {
          id: uuidv4(),
          name: params.name,
          schoolId: params.schoolId,
          isPublic: params.isPublic,
        },
      })

      // 创建团队负责人成员记录
      await tx.teamMember.create({
        data: {
          id: uuidv4(),
          teamId: team.id,
          userId: params.leaderId,
          userType: 'teacher',
          role: 'owner',
          status: 'active',
          joinedAt: new Date(),
        },
      })

      return team
    })
  }

  /**
   * 获取用户平台绑定状态
   */
  async getUserPlatformBinding(userId: string, platform: string) {
    return prisma.userPlatformBinding.findUnique({
      where: {
        userId_platform: {
          userId,
          platform,
        },
      },
    })
  }

  /**
   * 获取团队信息
   */
  async getTeamById(teamId: string) {
    return prisma.team.findUnique({
      where: { id: teamId },
      include: {
        School: true,
      },
    })
  }

  /**
   * 获取用户管理的团队列表
   */
  async getTeamsByAdmin(teacherId: string) {
    // 获取教师作为管理员的团队
    const adminMembers = await prisma.teamMember.findMany({
      where: {
        userId: teacherId,
        userType: 'teacher',
        role: { in: ['owner', 'admin'] },
        status: 'active',
      },
      include: {
        Team: {
          include: {
            School: true,
          },
        },
      },
    })

    return adminMembers.map((m) => ({
      id: m.Team.id,
      name: m.Team.name,
      schoolId: m.Team.schoolId,
      schoolName: m.Team.School?.name,
    }))
  }

  /**
   * 检查用户是否有权限操作团队
   */
  async checkTeamPermission(teamId: string, teacherId: string): Promise<boolean> {
    const member = await prisma.teamMember.findFirst({
      where: {
        teamId,
        userId: teacherId,
        userType: 'teacher',
        role: { in: ['owner', 'admin'] },
        status: 'active',
      },
    })
    return !!member
  }

  /**
   * 创建导入批次
   */
  async createBatch(params: {
    teamId?: string
    operatorId: string
    platform: ImportPlatform
    rawInput: string
    totalCount: number
  }) {
    return prisma.teamMemberImportBatch.create({
      data: {
        id: crypto.randomUUID(),
        teamId: params.teamId || null,
        operatorId: params.operatorId,
        platform: params.platform,
        rawInput: params.rawInput,
        totalCount: params.totalCount,
        status: 'pending',
      },
    })
  }

  /**
   * 批量创建导入明细
   */
  async createImportItems(
    batchId: string,
    parsedRows: ParsedRow[],
    matchResults: MatchResult[]
  ) {
    const data = parsedRows.map((row, index) => {
      const match = matchResults[index]
      return {
        id: crypto.randomUUID(),
        batchId,
        lineNumber: row.lineNumber,
        rawUsername: row.rawUsername,
        rawStudentName: row.rawStudentName || null,
        parsedUsername: row.parsedUsername,
        candidateDisplayName: row.candidateDisplayName,
        matchType: match?.matchType || 'invalid',
        matchStatus: 'pending',
        matchedStudentId: match?.matchedStudentId || null,
        matchedStudentName: match?.matchedStudentName || null,
        action: match?.suggestedAction || null,
      }
    })

    return prisma.teamMemberImportItem.createMany({
      data,
      // SQLite 不支持 skipDuplicates
    })
  }

  /**
   * 获取批次信息
   */
  async getBatchById(batchId: string) {
    return prisma.teamMemberImportBatch.findUnique({
      where: { id: batchId },
      include: {
        Team: {
          include: {
            School: true,
          },
        },
      },
    })
  }

  /**
   * 获取批次明细
   */
  async getBatchItems(batchId: string) {
    return prisma.teamMemberImportItem.findMany({
      where: { batchId },
      orderBy: { lineNumber: 'asc' },
    })
  }

  /**
   * 更新批次状态
   */
  async updateBatchStatus(batchId: string, status: string) {
    return prisma.teamMemberImportBatch.update({
      where: { id: batchId },
      data: { status },
    })
  }

  /**
   * 更新批次统计
   */
  async updateBatchStats(
    batchId: string,
    stats: { successCount: number; skipCount: number; errorCount: number }
  ) {
    return prisma.teamMemberImportBatch.update({
      where: { id: batchId },
      data: {
        ...stats,
        status: 'completed',
        completedAt: new Date(),
      },
    })
  }

  /**
   * 更新导入项状态
   */
  async updateItemStatus(
    itemId: string,
    data: {
      matchStatus: string
      processedAt: Date
      createdStudentId?: string
      errorMessage?: string
    }
  ) {
    return prisma.teamMemberImportItem.update({
      where: { id: itemId },
      data,
    })
  }

  /**
   * 按学生姓名查找学生
   */
  async findStudentByName(schoolId: string, name: string) {
    // SQLite 不支持 mode: 'insensitive'，使用精确匹配
    return prisma.student.findFirst({
      where: {
        schoolId,
        name,
      },
    })
  }

  /**
   * 查找学生的平台绑定
   */
  async findStudentPlatformBinding(studentId: string, platform: string) {
    // 学生目前没有直接的平台绑定，使用 UserPlatformBinding
    const student = await prisma.student.findUnique({
      where: { id: studentId },
    })
    if (!student) return null

    return prisma.userPlatformBinding.findUnique({
      where: {
        userId_platform: {
          userId: student.id,
          platform,
        },
      },
    })
  }

  /**
   * 查找团队内的外部账号
   */
  async findExternalAccountInTeam(teamId: string, platform: string, username: string) {
    return prisma.teamMemberExternalAccount.findUnique({
      where: {
        teamId_platform_platformUsername: {
          teamId,
          platform,
          platformUsername: username,
        },
      },
      include: {
        Student: true,
      },
    })
  }

  /**
   * 查找全局平台用户名绑定（用于冲突检测）
   */
  async findGlobalPlatformBinding(platform: string, username: string) {
    return prisma.teamMemberExternalAccount.findMany({
      where: {
        platform,
        platformUsername: username,
      },
      include: {
        Team: {
          include: {
            School: true,
          },
        },
        Student: true,
      },
    })
  }

  /**
   * 获取团队成员（学生）
   */
  async getTeamStudentMembers(teamId: string) {
    const members = await prisma.teamMember.findMany({
      where: {
        teamId,
        userType: 'student',
        status: 'active',
      },
      include: {
        Team: true,
      },
    })

    // 获取学生详情
    const studentIds = members.map((m) => m.userId)
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds } },
    })

    return members.map((m) => ({
      ...m,
      student: students.find((s) => s.id === m.userId),
    }))
  }

  /**
   * 创建外部账号关联
   */
  async createExternalAccount(params: {
    teamId: string
    studentId?: string
    platform: string
    platformUsername: string
    displayName?: string
    status?: string
  }) {
    return prisma.teamMemberExternalAccount.create({
      data: {
        id: crypto.randomUUID(),
        teamId: params.teamId,
        studentId: params.studentId || null,
        platform: params.platform,
        platformUsername: params.platformUsername,
        displayName: params.displayName || null,
        status: params.status || 'pending',
      },
    })
  }

  /**
   * 更新外部账号关联
   */
  async updateExternalAccount(id: string, data: { studentId?: string; status?: string }) {
    return prisma.teamMemberExternalAccount.update({
      where: { id },
      data,
    })
  }

  /**
   * 创建团队成员邀请
   */
  async createTeamInvite(params: {
    teamId: string
    studentId: string
    invitedBy: string
  }) {
    // 先检查是否已有成员记录
    const existing = await prisma.teamMember.findFirst({
      where: {
        teamId: params.teamId,
        userId: params.studentId,
        userType: 'student',
      },
    })

    if (existing) {
      // 如果已存在但状态为 pending，更新 invitedBy
      if (existing.status === 'pending') {
        return prisma.teamMember.update({
          where: { id: existing.id },
          data: { invitedBy: params.invitedBy },
        })
      }
      return existing
    }

    // 创建新的邀请记录
    return prisma.teamMember.create({
      data: {
        id: uuidv4(),
        teamId: params.teamId,
        userId: params.studentId,
        userType: 'student',
        role: 'member',
        status: 'pending',
        invitedBy: params.invitedBy,
      },
    })
  }

  /**
   * 创建学生（带用户账号）
   */
  async createStudentWithUser(params: {
    name: string
    schoolId: string
    headTeacherId: string
    username: string
    passwordHash: string
  }) {
    return prisma.$transaction(async (tx) => {
      // 创建用户
      const userId = uuidv4()
      const user = await tx.user.create({
        data: {
          id: userId,
          username: params.username,
          passwordHash: params.passwordHash,
          role: 'student',
          status: 'active',
          schoolId: params.schoolId,
        },
      })

      // 创建学生
      const student = await tx.student.create({
        data: {
          id: user.id,
          name: params.name,
          schoolId: params.schoolId,
          headTeacherId: params.headTeacherId,
        },
      })

      return { user, student }
    })
  }

  /**
   * 获取团队的导入历史
   */
  async getImportHistory(teamId: string, limit = 10) {
    return prisma.teamMemberImportBatch.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }
}
