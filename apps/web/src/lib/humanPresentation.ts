export const humanTerms = {
  evaluationCredits: '评测额度',
  testSetRevision: '测试数据版本',
  qualityScore: '数据质量评分',
  organization: '学校',
} as const

export function testDataVersion(revision: number | null | undefined, technical = false) {
  if (!technical) return '使用发布时固定的数据评测'
  return revision == null ? '测试数据版本待确认' : `测试数据版本 R${revision}`
}

export function trainingStatusLabel(status: string) {
  return ({ DRAFT: '草稿', SCHEDULED: '待开始', RUNNING: '进行中', PAUSED: '已暂停', ENDED: '已结束', ARCHIVED: '已归档' } as Record<string, string>)[status] || status
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
