/**
 * Team Module - Zod Validation Schemas
 * 团队模块校验 schema
 */

import { z } from 'zod'

// ==================== 成员类型 ====================

export const memberTypeSchema = z.enum(['teacher', 'student', 'user'])
export const memberRoleSchema = z.enum(['owner', 'admin', 'member'])
export const memberStatusSchema = z.enum(['pending', 'active'])

// ==================== 团队 CRUD ====================

export const createTeamSchema = z.object({
  id: z.string()
    .min(2, '团队ID至少2个字符')
    .max(50, '团队ID不能超过50个字符')
    .regex(/^[a-zA-Z0-9_]+$/, '团队ID只能包含英文字母、数字和下划线'),
  name: z.string().min(1, '团队名称不能为空').max(100, '团队名称最多100字符'),
  description: z.string().max(500, '团队描述最多500字符').optional(),
  schoolId: z.string().min(1, '学校ID不能为空').optional(),
  isPublic: z.boolean().optional().default(true)
})

export const updateTeamSchema = z.object({
  name: z.string().min(1, '团队名称不能为空').max(100, '团队名称最多100字符').optional(),
  description: z.string().max(500, '团队描述最多500字符').optional(),
  isPublic: z.boolean().optional(),
  announcement: z.string().max(2000, '公告最多2000字符').optional()
})

// ==================== 成员管理 ====================

export const addMembersSchema = z.object({
  members: z.array(z.object({
    userId: z.string().min(1, '用户ID不能为空'),
    userType: memberTypeSchema,
    role: memberRoleSchema.optional().default('member')
  })).min(1, '至少添加一个成员').max(50, '最多添加50个成员').optional(),
  usernames: z.array(z.string().min(1)).max(50).optional(),
  role: memberRoleSchema.optional().default('member')
}).refine(
  data => data.members || data.usernames,
  { message: '必须提供 members 或 usernames' }
)

export const memberIdSchema = z.object({
  id: z.string().min(1, '团队ID不能为空'),
  memberId: z.string().min(1, '成员ID不能为空')
})

export const setAdminSchema = z.object({
  memberId: z.string().min(1, '成员ID不能为空'),
  memberType: memberTypeSchema.optional()
})

// ==================== 邀请处理 ====================

export const invitationIdSchema = z.object({
  invitationId: z.string().min(1, '邀请ID不能为空')
})

// ==================== 申请处理 ====================

export const requestIdSchema = z.object({
  requestId: z.string().min(1, '申请ID不能为空')
})

export const joinRequestSchema = z.object({
  message: z.string().max(500, '申请留言最多500字符').optional()
})

// ==================== 分页查询 ====================

export const teamListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  schoolId: z.string().optional(),
  keyword: z.string().optional(),
  isPublic: z.coerce.boolean().optional()
})

export const teamIdSchema = z.object({
  id: z.string().min(1, '团队ID不能为空')
})

// ==================== 团队转移 ====================

export const transferTeamSchema = z.object({
  newOwnerId: z.string().min(1, '新所有者ID不能为空'),
  newOwnerType: memberTypeSchema
})

// ==================== 公告更新 ====================

export const updateAnnouncementSchema = z.object({
  announcement: z.string().max(2000, '公告最多2000字符').optional().nullable()
})

// ==================== 类型导出 ====================

export type CreateTeamInput = z.infer<typeof createTeamSchema>
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>
export type AddMembersInput = z.infer<typeof addMembersSchema>
export type JoinRequestInput = z.infer<typeof joinRequestSchema>
export type TeamListQuery = z.infer<typeof teamListQuerySchema>
