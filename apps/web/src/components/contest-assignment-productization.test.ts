import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

describe('contest and assignment productization regressions', () => {
  it('scopes the teacher contest team selector to the active organization', () => {
    const source = read('./organization-pages/teacher/contests/page.tsx')
    expect(source).toContain('organizationId=${encodeURIComponent(organizationId)}&view=mine')
  })

  it('uses a five-step contest wizard with number-only problem selection', () => {
    const source = read('../features/contest/ui/ContestFormModal.tsx')
    expect(source).toContain("['基本信息', '赛制与 Rating', '题目', '可见性', '发布前检查']")
    expect(source).toContain('比赛赛制')
    expect(source).toContain('Rating 范围')
    expect(source).toContain('QuickProblemInput')
    expect(source).not.toContain('选择比赛题目')
    expect(source).not.toContain('按 OJ 题号快速添加')
    expect(source).not.toContain('搜索题号或标题')
    expect(source).not.toContain('添加题目到训练中')
    expect(source).not.toContain('placeholder="训练标题"')
  })

  it('presents one problem workspace and keeps materials out of primary tabs', () => {
    const source = read('../features/contest/ui/ContestDetailPage.tsx')
    expect(source).toContain("{ value: 'problems' as const, label: '题目' }")
    expect(source).toContain("{ value: 'submissions' as const, label: '提交记录' }")
    expect(source).not.toContain("{ value: 'problemList' as const, label: '题目列表' }")
    expect(source).not.toContain("{ value: 'attachments' as const, label: '附件' }")
  })

  it('uses server assignment totals, pagination and an active student default', () => {
    const source = read('../features/assignment/ui/AssignmentListPage.tsx')
    expect(source).toContain("useState<Filter>('active')")
    expect(source).toContain('statusCounts')
    expect(source).toContain('statusGroup=${filter}')
    expect(source).toContain('查看历史作业')
    expect(source).toContain('先填写作业名称和截止时间，随后选择题目和学生。')
    expect(source).not.toContain('创建作业草稿')
  })
})
