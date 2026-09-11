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

export function technicalLabel(label: string) {
  return `技术详情：${label}`
}
