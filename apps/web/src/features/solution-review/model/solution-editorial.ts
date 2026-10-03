export const SOLUTION_TYPE_LABELS = {
  OFFICIAL_EDITORIAL: '官方题解',
  COMMUNITY_EDITORIAL: '社区题解',
  ALTERNATIVE_SOLUTION: '不同解法',
  EXPLANATION: '补充讲解',
  CORRECTION: '纠错',
  TRANSLATION: '翻译',
} as const

export const SOLUTION_STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿', SUBMITTED: '已提交', AUTO_CHECKING: '自动验证中',
  TECHNICALLY_VALID: '技术验证通过', UNDER_REVIEW: '审核中',
  NEEDS_REVISION: '需修改', REJECTED: '已拒绝', ACCEPTED: '已采纳', PUBLISHED: '已发布',
}

export const VERIFICATION_STATUS_LABELS: Record<string, string> = {
  QUEUED: '排队中', RUNNING: '验证中', PASSED: '已通过', FAILED: '未通过',
  INFRA_ERROR: '验证服务异常', SKIPPED: '无需代码验证',
}

export function solutionStatusLabel(status: string) {
  return SOLUTION_STATUS_LABELS[status] || '状态待确认'
}

export function solutionVerificationLabel(status: string) {
  return VERIFICATION_STATUS_LABELS[status] || '验证状态待确认'
}

export function solutionReviewTypeLabel(type: string) {
  return ({ CONTENT: '内容审核', TECHNICAL: '技术审核', COPYRIGHT: '版权审核' } as Record<string, string>)[type] || '审核类型待确认'
}

export function solutionReviewDecisionLabel(decision: string) {
  return ({ APPROVE: '通过', REQUEST_REVISION: '要求修改', REJECT: '拒绝', ACCEPT: '采纳', PUBLISH: '发布' } as Record<string, string>)[decision] || '审核结论待确认'
}

export type SolutionType = keyof typeof SOLUTION_TYPE_LABELS
export type SolutionDraftLike = {
  type: SolutionType
  title: string
  contentMarkdown: string
  complexityTime?: string | null
  complexityMemory?: string | null
  language?: string | null
  referenceCode?: string | null
  sourceType: 'ORIGINAL' | 'DERIVED' | 'TRANSLATED' | 'AUTHORIZED'
  sourceUrl?: string | null
  citation?: string | null
  licenseAccepted: boolean
}

const FULL_TYPES: SolutionType[] = ['OFFICIAL_EDITORIAL', 'COMMUNITY_EDITORIAL', 'ALTERNATIVE_SOLUTION']

export function isFullSolutionType(type: SolutionType) {
  return FULL_TYPES.includes(type)
}

export function canEditSolutionContribution(status: string) {
  return status === 'DRAFT' || status === 'NEEDS_REVISION'
}

export function solutionSubmissionAction(status: string): 'submit' | 'resubmit' | null {
  if (status === 'DRAFT') return 'submit'
  if (status === 'NEEDS_REVISION') return 'resubmit'
  return null
}

export function validateSolutionDraft(draft: SolutionDraftLike): string | null {
  if (draft.title.trim().length < 3) return '标题至少需要 3 个字符'
  if (!draft.contentMarkdown.trim()) return '题解内容不能为空'
  if (!draft.licenseAccepted) return '请确认原创或授权声明'
  if (draft.sourceType !== 'ORIGINAL' && !draft.sourceUrl?.trim() && !draft.citation?.trim()) {
    return '非原创内容需要填写来源链接或引用说明'
  }
  if (draft.sourceUrl?.trim()) {
    try {
      const url = new URL(draft.sourceUrl)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '来源链接必须是 HTTP(S) 地址'
    } catch { return '来源链接格式无效' }
  }
  if (isFullSolutionType(draft.type)) {
    if (draft.contentMarkdown.trim().length < 80) return '完整题解至少需要 80 个字符'
    if (!draft.complexityTime?.trim() || !draft.complexityMemory?.trim()) return '请填写时间和空间复杂度'
    if (!draft.language?.trim() || !draft.referenceCode?.trim()) return '请填写参考代码及语言'
  }
  return null
}

export function reviewActionsForStatus(status: string) {
  if (status === 'TECHNICALLY_VALID') return ['approve', 'request-revision', 'reject'] as const
  if (status === 'UNDER_REVIEW') return ['accept', 'request-revision', 'reject'] as const
  if (status === 'ACCEPTED') return ['publish'] as const
  return [] as const
}
