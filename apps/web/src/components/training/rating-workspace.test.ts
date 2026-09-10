import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('contest Rating workspace contract', () => {
  it('renders only the scopes allowed by the server and resets an invalid draft scope', () => {
    const source = fs.readFileSync(new URL('./TrainingFormModal.tsx', import.meta.url), 'utf8')

    expect(source).toContain('config.allowedScopes')
    expect(source).toContain("allowedRatingScopes.includes('NONE')")
    expect(source).toContain("allowedRatingScopes.includes('ORGANIZATION')")
    expect(source).toContain("allowedRatingScopes.includes('GLOBAL')")
    expect(source).toContain("allowedRatingScopes.includes('BOTH')")
    expect(source).toContain("if (!allowedRatingScopes.includes(ratingScope)) setRatingScope('NONE')")
    expect(source).toContain('组织比赛只能影响本组织 Rating。')
    expect(source).toContain('个人团队赛 V1 不计个人 Rating。')
  })

  it('keeps finalization and rebuild actions in the shared settlement panel', () => {
    const source = fs.readFileSync(new URL('./components/TrainingRatingPanel.tsx', import.meta.url), 'utf8')

    expect(source).toContain("kind === 'finalize' ? 'finalize' : 'rating/rebuild'")
    expect(source).toContain('apiClient.post<RatingPayload>')
    expect(source).toContain('生成最终榜单并结算')
    expect(source).toContain('重放最终榜单与 Rating')
    expect(source).toContain('查看不可变最终榜单')
    expect(source).toContain("status === 'HELD'")
    expect(source).toContain('role="alert"')
  })

  it('requires a visible organization choice before multi-organization BOTH participation', () => {
    const source = fs.readFileSync(new URL('./components/TrainingRatingPanel.tsx', import.meta.url), 'utf8')

    expect(source).toContain('/rating-participation')
    expect(source).toContain('requiresExplicitSelection')
    expect(source).toContain('aria-label="参赛组织"')
    expect(source).toContain('首次提交后固定')
    expect(source).toContain('保存归属')
    expect(source).toContain('disabled={!selectedOrganizationId}')
  })

  it('guides contest creation through five human-readable steps', () => {
    const source = fs.readFileSync(new URL('./TrainingFormModal.tsx', import.meta.url), 'utf8')

    expect(source).toContain("['基本信息', '赛制与 Rating', '题目', '可见性', '发布前检查']")
    expect(source).toContain('影响强度：标准比赛的')
    expect(source).toContain('下一步')
    expect(source).toContain("`创建${mode === 'contest' ? '比赛'")
    expect(source).toContain('contestValidationIssues')
    expect(source).toContain('比赛草稿已保留')
    expect(source).toContain('进入比赛草稿')
  })

  it('explains Rating results in user-facing language', () => {
    const source = fs.readFileSync(new URL('./components/TrainingRatingPanel.tsx', import.meta.url), 'utf8')

    expect(source).toContain('本场计 Rating')
    expect(source).toContain('影响强度：标准比赛的')
    expect(source).toContain('首次提交后，你在本场比赛中的组织归属将固定')
    expect(source).toContain('NOT_ENOUGH_PARTICIPANTS')
  })
})
