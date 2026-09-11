import { describe, expect, it } from 'vitest'
import { emptyBlogReference, validateBlogDraft } from './blog-contract'

describe('blog knowledge publishing contract', () => {
  it('requires concrete fixed identities for versioned references', () => {
    expect(validateBlogDraft({ title: '笔记', contentMarkdown: '正文', references: [{ ...emptyBlogReference('PROBLEM_REVISION'), problemId: 'p1' }] })).toContain('固定的数据版本')
    expect(validateBlogDraft({ title: '笔记', contentMarkdown: '正文', references: [{ ...emptyBlogReference('SOLUTION_VERSION'), solutionVersionId: 'v1' }] })).toBeNull()
  })

  it('keeps ordinary blog references structurally separate from solution publication', () => {
    const reference = emptyBlogReference('PROBLEM') as Record<string, unknown>
    expect(reference).not.toHaveProperty('problemSolutionId')
    expect(reference).not.toHaveProperty('publishAsSolution')
  })

  it('keeps author classification bounded', () => {
    expect(validateBlogDraft({
      title: '系列笔记',
      contentMarkdown: '正文',
      references: [],
      classification: { seriesId: 'series-1', tagIds: ['system-1'], authorTags: ['a', 'b', 'c', 'd', 'e'] },
    })).toContain('5 个标签')
  })
})
