export const humanTerms = {
  evaluationCredits: '评测额度',
  qualityScore: '数据质量评分',
  organization: '学校',
} as const

export function testDataVersion(_revision?: number | null, _diagnostic = false) {
  return '使用发布时固定的数据评测'
}

export function trainingStatusLabel(status: string) {
  return ({ DRAFT: '草稿', SCHEDULED: '待开始', RUNNING: '进行中', PAUSED: '已暂停', ENDED: '已结束', ARCHIVED: '已归档' } as Record<string, string>)[status] || '状态待确认'
}

export function trainingStageStatusLabel(status: string) {
  return ({ PENDING: '未开始', RUNNING: '进行中', PAUSED: '已暂停', ENDED: '已完成', SKIPPED: '已跳过' } as Record<string, string>)[status] || '状态待确认'
}

export function trainingProgressStatusLabel(status: string) {
  return ({ NOT_STARTED: '未开始', WORKING: '进行中', STUCK: '可能卡题', COMPLETED: '已完成', SKIPPED: '已跳过', PAUSED: '已暂停', LOCKED: '尚未开放' } as Record<string, string>)[status] || '状态待确认'
}

export function trainingStageKindLabel(kind: string) {
  return ({ TRAINING: '训练', TEACHING: '统一讲解', REVIEW: '复盘' } as Record<string, string>)[kind] || '训练阶段'
}

export function trainingHintOpenModeLabel(mode: string) {
  return ({ MANUAL: '教练手动', TIME: '按训练时间', ATTEMPT: '按提交次数', SCORE: '按最高分数' } as Record<string, string>)[mode] || '开放方式待确认'
}

export function trainingStageEndReasonLabel(reason: string) {
  const known = ({ TIME_REACHED: '达到计划时长', COMPLETION_REACHED: '达到完成要求', HYBRID_REACHED: '达到阶段要求', TEACHER_ENDED: '教师结束', TEACHER_ENDED_EARLY: '教师提前结束', SESSION_ENDED: '训练已结束', SYSTEM_ENDED: '系统结束' } as Record<string, string>)[reason]
  if (known) return known
  return '结束原因待确认'
}

export function trainingPermissionReasonLabel(reason: string) {
  return ({
    ALLOWED: '可以提交', SEQUENTIAL_LOCK: '完成前一道题后开放', FOCUS_REQUIRED: '等待教师开放',
    FOCUS_LOCK: '等待教师开放', PROBLEM_LOCKED: '题目暂时锁定', STAGE_NOT_RUNNING: '当前阶段尚未开始',
    STAGE_ENDED: '当前阶段已经结束', SUBMISSION_DISABLED: '当前阶段不开放提交', SESSION_PAUSED: '训练已暂停',
    SESSION_ENDED: '训练已经结束', NOT_PARTICIPANT: '不在本次训练名单中',
  } as Record<string, string>)[reason] || '当前暂不可提交'
}

export function trainingSessionTypeLabel(type: string) {
  return ({ OI: 'OI 训练', ACM: 'ACM 训练', GENERAL: '综合训练' } as Record<string, string>)[type] || '训练'
}

export function activityStatusLabel(status: string) {
  return ({
    DRAFT: '草稿', SCHEDULED: '待开始', RUNNING: '进行中', PAUSED: '已暂停',
    ENDED: '已结束', ARCHIVED: '已归档', PUBLISHED: '已发布', CANCELLED: '已取消',
    upcoming: '待开始', ongoing: '进行中', finished: '已结束', draft: '草稿',
    published: '已发布', cancelled: '已取消',
  } as Record<string, string>)[status] || '状态待确认'
}

export function reviewStatusLabel(status: string) {
  return ({ pending: '待处理', resolved: '已处理', dismissed: '已驳回' } as Record<string, string>)[status] || '状态待确认'
}

export function membershipStatusLabel(status: string) {
  return ({
    pending: '待处理', approved: '已通过', rejected: '已拒绝', cancelled: '已撤销',
    accepted: '已接受', declined: '已拒绝', revoked: '已撤回', expired: '已过期',
    active: '正常', inactive: '已停用', archived: '已归档',
  } as Record<string, string>)[status] || '状态待确认'
}

export function organizationRoleLabel(role: string) {
  return ({
    student: '学生', teacher: '教师', principal: '学校负责人', school_principal: '学校负责人',
    admin: '管理员', platform_admin: '平台管理员', super_admin: '超级管理员',
    user: '普通用户',
  } as Record<string, string>)[role] || '身份待确认'
}

export function genericStatusLabel(status: string) {
  return ({
    pending: '待处理', processing: '处理中', running: '进行中', completed: '已完成',
    succeeded: '已完成', failed: '失败', cancelled: '已取消', rejected: '已拒绝',
    approved: '已通过', active: '正常', inactive: '已停用', archived: '已归档',
    PENDING: '待处理', PROCESSING: '处理中', RUNNING: '进行中', COMPLETED: '已完成',
    SUCCEEDED: '已完成', FAILED: '失败', CANCELLED: '已取消', REJECTED: '已拒绝',
    APPROVED: '已通过', ACTIVE: '正常', INACTIVE: '已停用', ARCHIVED: '已归档',
  } as Record<string, string>)[status] || '状态待确认'
}
