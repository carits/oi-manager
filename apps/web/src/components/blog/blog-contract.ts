export type BlogPostType = 'ARTICLE' | 'SOLUTION_NOTE' | 'CONTEST_REVIEW' | 'TRAINING_LOG' | 'LEARNING_LOG' | 'TUTORIAL' | 'COLLECTION' | 'ANNOUNCEMENT'
export type BlogVisibility = 'PRIVATE' | 'ORGANIZATION' | 'PLATFORM' | 'UNLISTED' | 'PUBLIC'
export type BlogReferenceType = 'PROBLEM' | 'PROBLEM_REVISION' | 'SOLUTION_VERSION' | 'CONTEST_STANDING' | 'RATING_CHANGE'
export type PublishedBlogReferenceType = BlogReferenceType | 'SUBMISSION_SNAPSHOT'
export type BlogReferenceRelation = 'PRIMARY_SUBJECT' | 'MENTION' | 'SOURCE' | 'RESULT'
export type BlogReferenceDisplay = 'CARD' | 'INLINE' | 'COMPACT' | 'EMBED' | 'HIDDEN_METADATA'

export type BlogDraftReference = {
  type: BlogReferenceType
  problemId?: string
  problemRevisionId?: string
  solutionVersionId?: string
  standingSnapshotId?: string
  ratingChangeId?: string
  relationType: BlogReferenceRelation
  displayMode: BlogReferenceDisplay
  positionKey?: string
}

export type BlogDraftClassification = {
  seriesId: string | null
  tagIds: string[]
  authorTags: string[]
}

export type BlogClassificationSnapshot = {
  series: { id: string; title: string; visibility: BlogVisibility; organizationId?: string | null } | null
  tags: Array<{ id: string; name: string; kind: 'SYSTEM' | 'USER' }>
}

export const EMPTY_BLOG_CLASSIFICATION: BlogDraftClassification = { seriesId: null, tagIds: [], authorTags: [] }

export const BLOG_TYPE_LABELS: Record<BlogPostType, string> = {
  ARTICLE: '知识文章',
  SOLUTION_NOTE: '题解学习笔记',
  CONTEST_REVIEW: '比赛复盘',
  TRAINING_LOG: '训练记录',
  LEARNING_LOG: '学习记录',
  TUTORIAL: '教程',
  COLLECTION: '知识合集',
  ANNOUNCEMENT: '公告',
}

export const BLOG_VISIBILITY_LABELS: Record<BlogVisibility, string> = {
  PRIVATE: '仅自己',
  ORGANIZATION: '当前学校',
  PLATFORM: '登录用户可见',
  UNLISTED: '不公开列出（持链接可见）',
  PUBLIC: '互联网公开',
}

export const BLOG_REFERENCE_LABELS: Record<BlogReferenceType, string> = {
  PROBLEM: '题目（跟随当前信息）',
  PROBLEM_REVISION: '题目测试数据（固定内容）',
  SOLUTION_VERSION: '题解（固定内容）',
  CONTEST_STANDING: '比赛榜单（固定内容）',
  RATING_CHANGE: 'Rating 变化（固定记录）',
}

export const BLOG_PUBLISHED_REFERENCE_LABELS: Record<PublishedBlogReferenceType, string> = {
  ...BLOG_REFERENCE_LABELS,
  SUBMISSION_SNAPSHOT: '提交快照（固定安全副本）',
}

export function emptyBlogReference(type: BlogReferenceType = 'PROBLEM'): BlogDraftReference {
  return { type, relationType: 'MENTION', displayMode: 'CARD' }
}

export function validateBlogDraft(input: { title: string; contentMarkdown: string; references: BlogDraftReference[]; classification?: BlogDraftClassification }) {
  if (!input.title.trim()) return '请填写标题'
  if (new TextEncoder().encode(input.contentMarkdown).byteLength > 1024 * 1024) return '正文不能超过 1 MiB'
  if (input.references.length > 50) return '每篇文章最多添加 50 个结构化引用'
  if ((input.classification?.tagIds.length || 0) + (input.classification?.authorTags.length || 0) > 5) return '每篇文章最多使用 5 个标签'
  for (const [index, reference] of input.references.entries()) {
    const prefix = `第 ${index + 1} 个引用`
    if (reference.type === 'PROBLEM' && !reference.problemId?.trim()) return `${prefix}尚未选择题目`
    if (reference.type === 'PROBLEM_REVISION' && (!reference.problemId?.trim() || !reference.problemRevisionId?.trim())) return `${prefix}必须选择题目和固定的数据版本`
    if (reference.type === 'SOLUTION_VERSION' && !reference.solutionVersionId?.trim()) return `${prefix}尚未关联题解，请从题解页面重新进入写作`
    if (reference.type === 'CONTEST_STANDING' && !reference.standingSnapshotId?.trim()) return `${prefix}尚未关联比赛榜单，请从榜单页面重新进入写作`
    if (reference.type === 'RATING_CHANGE' && !reference.ratingChangeId?.trim()) return `${prefix}尚未关联 Rating 记录，请从 Rating 页面重新进入写作`
  }
  return null
}

export function referenceSnapshotTitle(reference: { type: PublishedBlogReferenceType; snapshot?: any }) {
  const snapshot = reference.snapshot || {}
  if (reference.type === 'PROBLEM' || reference.type === 'PROBLEM_REVISION') return snapshot.title || snapshot.problemId || '题目'
  if (reference.type === 'SOLUTION_VERSION') return snapshot.title || '题解版本'
  if (reference.type === 'CONTEST_STANDING') return snapshot.title || '比赛榜单'
  if (reference.type === 'RATING_CHANGE') return snapshot.contest?.title || 'Rating 变化'
  if (reference.type === 'SUBMISSION_SNAPSHOT') return `${snapshot.sourcePlatform || '平台'} · ${snapshot.sourceProblemId || '题目'} 提交快照`
  return '引用'
}
