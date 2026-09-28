export const humanTerms = {
  evaluationCredits: '评测额度',
  testSetSlot: '测试数据槽位',
  qualityScore: '数据质量评分',
  organization: '学校',
} as const

export function testDataVersion(revision: number | null | undefined, technical = false) {
  if (!technical) return '使用发布时固定的数据评测'
  return revision == null ? '测试数据版本待确认' : `测试数据版本 R${revision}`
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
  return /^[A-Z][A-Z0-9_]*$/.test(reason) ? '结束原因待确认' : reason
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

export function technicalLabel(label: string) {
  return `技术详情：${label}`
}
