'use client'

import { useMemo } from 'react'

/**
 * 用户类型
 */
export type UserType = 'teacher' | 'student' | 'user'

/**
 * 成员角色
 */
export type MemberRole = 'owner' | 'admin' | 'member'

/**
 * 团队权限
 */
export interface TeamPermission {
  /** 是否是所有者 */
  isOwner: boolean
  /** 是否是管理员（包括所有者） */
  isAdmin: boolean
  /** 是否是团队成员（包括所有者、管理员、普通成员） */
  isMember: boolean
  /** 用户在该团队中的角色 */
  role: MemberRole | null

  // 操作权限
  /** 可以编辑团队信息 */
  canEdit: boolean
  /** 可以邀请成员 */
  canInvite: boolean
  /** 可以移除成员 */
  canRemove: boolean
  /** 可以处理加入申请 */
  canManageRequests: boolean
  /** 可以转移所有者 */
  canTransfer: boolean
  /** 可以解散团队 */
  canDissolve: boolean
}

/**
 * 团队数据结构（权限判断需要的字段）
 */
export interface TeamForPermission {
  owner?: {
    id: string
    type?: string  // 'teacher' | 'student' but from API can be string
  } | null
  ownerType?: string  // 兼容旧格式 'teacher' | 'student'
  admins?: Array<{
    id: string
    adminType?: string
    type?: string
  }>
  teachers?: Array<{ id: string }>
  students?: Array<{ id: string }>
}

/**
 * 计算团队权限的 Hook
 *
 * @param team 团队数据
 * @param userId 当前用户ID（teacherId 或 studentId）
 * @param userType 用户类型
 * @returns 权限对象
 */
export function useTeamPermission(
  team: TeamForPermission | null | undefined,
  userId: string | null | undefined,
  userType: UserType
): TeamPermission {
  return useMemo(() => {
    // 默认无权限
    const defaultPermission: TeamPermission = {
      isOwner: false,
      isAdmin: false,
      isMember: false,
      role: null,
      canEdit: false,
      canInvite: false,
      canRemove: false,
      canManageRequests: false,
      canTransfer: false,
      canDissolve: false
    }

    if (!team || !userId) {
      return defaultPermission
    }

    // 检查是否是所有者
    const ownerType = team.owner?.type || team.ownerType
    const isOwner = ownerType === userType && team.owner?.id === userId

    // 检查是否是管理员
    const isAdminMember = team.admins?.some(a =>
      a.id === userId && (a.adminType === userType || a.type === userType)
    ) || false
    const isAdmin = isOwner || isAdminMember

    // 检查是否是普通成员
    let isRegularMember = false
    if (userType === 'teacher') {
      isRegularMember = team.teachers?.some(t => t.id === userId) || false
    } else {
      isRegularMember = team.students?.some(s => s.id === userId) || false
    }
    const isMember = isAdmin || isRegularMember

    // 确定角色
    let role: MemberRole | null = null
    if (isOwner) {
      role = 'owner'
    } else if (isAdminMember) {
      role = 'admin'
    } else if (isMember) {
      role = 'member'
    }

    return {
      isOwner,
      isAdmin,
      isMember,
      role,

      // 操作权限
      canEdit: isAdmin,
      canInvite: isAdmin,
      canRemove: isAdmin,
      canManageRequests: isAdmin,
      canTransfer: isOwner,
      canDissolve: isOwner
    }
  }, [team, userId, userType])
}

/**
 * 获取角色标签文本
 */
export function getRoleLabel(role: MemberRole | null): string {
  if (!role) return '非成员'

  const roleLabels: Record<MemberRole, string> = {
    owner: '所有者',
    admin: '管理员',
    member: '成员'
  }

  return roleLabels[role]
}
