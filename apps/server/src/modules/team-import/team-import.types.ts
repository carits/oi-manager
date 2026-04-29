/**
 * 团队导入模块 - 类型定义
 */

/** 支持的导入平台 */
export type ImportPlatform = 'vjudge' | 'luogu'

// ==================== VJudge 导入相关类型 ====================

/** VJudge 团队列表项 */
export interface VjudgeGroupItem {
  groupId: string      // short_name
  groupName: string    // 团队名
}

/** VJudge 团队预览 */
export interface VjudgeGroupPreview {
  groupId: string
  groupName: string
  groupDescription?: string
  announcement?: string
  avatarUrl?: string
  members?: VjudgeMemberWithStatus[]
}

/** VJudge 成员（原始数据） */
export interface VjudgeMember {
  username: string
  nickname: string
}

/** 冲突类型 */
export type ConflictType =
  | 'username_same_school'   // 本校用户名冲突
  | 'name_same_school'       // 本校姓名冲突
  | 'username_diff_school'   // 外校用户名冲突

/** 单条冲突信息 */
export interface ConflictInfo {
  type: ConflictType
  message: string
  matchedStudentId?: string  // 新字段，指向 User.id
  matchedStudentName?: string
  matchedStudentGrade?: string
  matchedSchoolName?: string
  matchedUsername?: string
}

/** 校验结果中的单个成员 */
export interface MemberValidateResult {
  username: string           // 平台用户名（可能已被用户修改）
  nickname?: string          // 平台昵称
  studentName: string        // 学生姓名（可能已被用户修改）
  gender: string             // 性别
  conflicts: ConflictInfo[]  // 冲突列表，空则无冲突
  status: 'clear' | 'conflict'
}

/** 通用成员输入（所有平台导入共用） */
export interface MemberInput {
  username: string           // 平台用户名
  nickname?: string          // 平台昵称
  studentName: string        // 学生姓名
  gender: string             // 性别
  enrollmentYear?: number    // 入学年份
}

/** VJudge 成员（带匹配状态） */
export interface VjudgeMemberWithStatus extends VjudgeMember {
  status: 'new' | 'existing'
  matchedStudentId?: string  // 新字段，指向 User.id
  matchedStudentName?: string
  matchedStudentGrade?: string
  gender: string             // 性别，默认 '男'
  enrollmentYear?: number    // 新成员必填
  studentName?: string       // 可编辑
  selected?: boolean         // 是否选中导入
}

/** VJudge 导入成员输入 */
export interface VjudgeMemberInput {
  username: string
  nickname: string
  status: 'new' | 'existing' | 'invite' | 'skip'
  matchedStudentId?: string  // 新字段，指向 User.id
  matchedStudentName?: string
  studentName?: string
  gender?: string
  enrollmentYear?: number
  selected?: boolean
}

/** VJudge 预览请求 */
export interface VjudgePreviewRequest {
  shortName: string
  includeAnnouncement?: boolean
  includeDescription?: boolean
  includeMembers?: boolean
}

/** VJudge 导入请求 */
export interface VjudgeImportRequest {
  teamId?: string
  createTeam?: boolean
  visibility?: 'public' | 'private'
  teamName?: string
  vjudgeGroupId?: string
  avatarUrl?: string
  announcement?: string
  description?: string
  members: VjudgeMemberInput[]
}

/** VJudge 导入结果 */
export interface VjudgeImportResult {
  success: boolean
  message?: string
  createdCount: number
  invitedCount: number
  skippedCount: number
  errorCount: number
  details: VjudgeImportDetail[]
  teamId?: string
  teamName?: string
}

/** VJudge 导入详情 */
export interface VjudgeImportDetail {
  username: string
  nickname: string
  action: 'created' | 'invited' | 'skipped' | 'error'
  studentId?: string
  studentName?: string
  systemUsername?: string
  tempPassword?: string
  error?: string
}

// ==================== 洛谷导入相关类型 ====================

/** 洛谷团队列表项 */
export interface LuoguGroupItem {
  id: string
  name: string
}

/** 洛谷团队预览 */
export interface LuoguGroupPreview {
  groupId: string
  groupName: string
  announcement?: string
  members?: LuoguPreviewMember[]
}

/** 洛谷预览成员 */
export interface LuoguPreviewMember {
  username: string
  nickname: string
  studentName: string
  gender: string
}

/** 洛谷导入成员输入 */
export interface LuoguMemberInput {
  username: string
  nickname: string
  status: 'new' | 'existing' | 'invite' | 'skip'
  matchedStudentId?: string  // 新字段，指向 User.id
  matchedStudentName?: string
  studentName?: string
  gender?: string
  enrollmentYear?: number
  selected?: boolean
}

/** 洛谷导入请求 */
export interface LuoguImportRequest {
  teamId?: string
  createTeam?: boolean
  visibility?: 'public' | 'private'
  teamName?: string
  luoguTeamId?: string
  announcement?: string
  members: LuoguMemberInput[]
}

/** 洛谷导入结果 */
export interface LuoguImportResult {
  success: boolean
  message?: string
  createdCount: number
  invitedCount: number
  skippedCount: number
  errorCount: number
  details: LuoguImportDetail[]
  teamId?: string
  teamName?: string
}

/** 洛谷导入详情 */
export interface LuoguImportDetail {
  username: string
  nickname: string
  action: 'created' | 'invited' | 'skipped' | 'error'
  studentId?: string
  studentName?: string
  systemUsername?: string
  tempPassword?: string
  error?: string
}

// ==================== 原有类型 ====================

/** 平台信息 */
export interface PlatformInfo {
  id: ImportPlatform
  name: string
  supported: boolean
  userBindingStatus: 'bound' | 'unbound'
  userBindingUsername: string | null
}

/** 导入数据行 */
export interface ImportDataRow {
  username: string // 平台用户名（必填）
  studentName?: string // 学生姓名（可选）
}

/** 解析结果 */
export interface ParsedRow {
  lineNumber: number
  rawUsername: string
  rawStudentName?: string
  parsedUsername: string
  candidateDisplayName: string
  valid: boolean
  error?: string
}

/** 匹配类型 */
export type MatchType =
  | 'new_member' // 完全新成员
  | 'existing_member' // 已有同账号
  | 'same_name' // 疑似同名
  | 'conflict' // 账号冲突
  | 'invalid' // 非法数据

/** 匹配状态 */
export type MatchStatus =
  | 'pending' // 待处理
  | 'pending_confirm' // 待用户确认（疑似同名）
  | 'invited' // 已发送邀请
  | 'created' // 已创建新学生
  | 'skipped' // 已跳过
  | 'error' // 处理错误

/** 建议动作 */
export type SuggestedAction =
  | 'invite' // 发送邀请（已有学生）
  | 'create_and_invite' // 创建学生并发送邀请
  | 'link_only' // 仅关联账号（已在团队）
  | 'skip' // 跳过
  | 'manual_required' // 需要人工处理

/** 匹配结果 */
export interface MatchResult {
  lineNumber: number
  matchType: MatchType
  matchedStudentId?: string  // 新字段，指向 User.id
  matchedStudentName?: string
  suggestedAction: SuggestedAction
  canAutoProcess: boolean
  conflictReason?: string
  existingExternalAccount?: {
    id: string
    teamId: string
    teamName: string
    studentId?: string
    studentName?: string
  }
}

/** 预览响应 */
export interface PreviewResponse {
  batchId: string
  teamId: string
  platform: ImportPlatform
  totalRows: number
  parsedRows: ParsedRow[]
  matchResults: MatchResult[]
  summary: {
    newMembers: number // 完全新成员
    existingMembers: number // 已有同账号
    sameNameMatches: number // 疑似同名
    conflicts: number // 账号冲突
    invalidRows: number // 非法数据
  }
}

/** 确认导入请求 */
export interface ConfirmImportRequest {
  batchId: string
  items: Array<{
    lineNumber: number
    action: 'confirm' | 'skip'
    createStudent?: boolean // 是否创建新学生
    studentName?: string // 如果创建，指定学生姓名
  }>
}

/** 导入结果项 */
export interface ImportResultItem {
  lineNumber: number
  rawUsername: string
  matchType: MatchType
  action: string
  result: 'success' | 'skipped' | 'error'
  studentId?: string
  studentName?: string
  inviteId?: string
  errorMessage?: string
}

/** 导入结果 */
export interface ImportResult {
  batchId: string
  totalProcessed: number
  invitedCount: number // 发送邀请数
  createdCount: number // 创建新学生数
  linkedCount: number // 仅关联账号数
  skippedCount: number // 跳过数
  errorCount: number // 错误数
  items: ImportResultItem[]
}

/** 导入批次摘要 */
export interface ImportBatchSummary {
  id: string
  teamId: string
  teamName: string
  platform: ImportPlatform
  totalCount: number
  successCount: number
  skipCount: number
  errorCount: number
  status: string
  createdAt: Date
  completedAt?: Date
}
