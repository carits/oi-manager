/**
 * 团队导入 - 共享类型定义
 * 所有平台（VJudge、洛谷等）的导入共用
 */

/** 单条问题/冲突信息 */
export interface ConflictInfo {
  type: 'username_same_school' | 'name_same_school' | 'username_diff_school' | 'invalid_username'
  message: string
  matchedStudentId?: string
  matchedStudentName?: string
  matchedStudentGrade?: string
  matchedSchoolName?: string
  matchedUsername?: string
}

/** 导入成员 */
export interface ImportMember {
  username: string
  nickname: string
  studentName: string
  gender: string
  enrollmentYear?: number
  selected: boolean
  // 校验结果
  conflictStatus: 'unchecked' | 'clear' | 'conflict'
  conflicts: ConflictInfo[]
  // 操作决策
  action: 'create' | 'invite' | 'skip'
  inviteStudentId?: string
  inviteStudentName?: string
}

/** 校验 API 返回的单条结果 */
export interface ValidateResultItem {
  username: string
  nickname?: string
  studentName: string
  gender: string
  conflicts: ConflictInfo[]
  status: 'clear' | 'conflict'
}

/** 导入结果 */
export interface ImportResult {
  success: boolean
  message?: string
  createdCount: number
  invitedCount: number
  skippedCount: number
  errorCount: number
  details: ImportResultDetail[]
  teamId?: string
  teamName?: string
}

/** 导入详情 */
export interface ImportResultDetail {
  username: string
  nickname: string
  action: 'created' | 'invited' | 'skipped' | 'error'
  studentId?: string
  studentName?: string
  systemUsername?: string
  tempPassword?: string
  error?: string
}

/** 问题类型中文映射 */
export const CONFLICT_LABELS: Record<string, { text: string; color: string }> = {
  username_same_school: { text: '本校用户名冲突', color: '#ef4444' },
  name_same_school: { text: '本校姓名冲突', color: '#f59e0b' },
  username_diff_school: { text: '外校用户名冲突', color: '#8b5cf6' },
  invalid_username: { text: '用户名格式错误', color: '#ef4444' }
}

/** 用户名格式校验（通用：只允许英文字母、数字、下划线、连字符、点） */
export function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_.\-]+$/.test(username) && username.length >= 2
}
