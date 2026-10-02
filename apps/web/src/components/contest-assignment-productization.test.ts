import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

describe('contest and assignment productization regressions', () => {
  it('scopes the teacher contest team selector to the active organization', () => {
    const source = read('./organization-pages/teacher/contests/page.tsx')
    expect(source).toContain('organizationId=${encodeURIComponent(organizationId)}&view=mine')
  })

  it('keeps contest creation on one task-oriented page with direct problem editing', () => {
    const source = read('../features/contest/ui/ContestFormModal.tsx')
    expect(source).toContain('基本信息')
    expect(source).toContain('赛制与 Rating')
    expect(source).toContain('比赛题目')
    expect(source).toContain('可见性')
    expect(source).toContain('ProblemReferenceSelector')
    expect(source).toContain('editableReferences=')
    expect(source).toContain('aliasLabel="别名"')
    expect(source).toContain('dirty={formDirty || recoveryBlocked}')
    expect(source).toContain('loading={saving || loading}')
    expect(source).toContain('onClick={requestClose}')
    expect(source).not.toContain('wizardSteps')
    expect(source).not.toContain('canReachStep')
    expect(source).not.toContain('完成本步骤后可继续')
    expect(source).not.toContain('TableRoot')
    expect(source).not.toContain('搜索题号或标题')
    expect(source).not.toContain('添加题目到训练中')
    expect(source).not.toContain('placeholder="训练标题"')
  })

  it('keeps assignment draft sections parallel instead of forcing step navigation', () => {
    const source = read('../features/assignment/ui/AssignmentWorkspace.tsx')
    expect(source).toContain('保存基本信息')
    expect(source).toContain('保存题目')
    expect(source).toContain('保存学生名单')
    expect(source).toContain('editableReferences=')
    expect(source).toContain('onReplace={replaceProblems}')
    expect(source).not.toContain('designStep')
    expect(source).not.toContain('作业设计步骤')
    expect(source).not.toContain('点击“下一步”')
  })

  it('presents one problem workspace and keeps the selected materials route discoverable', () => {
    const source = read('../features/contest/ui/ContestDetailPage.tsx')
    expect(source).toContain("{ value: 'problems' as const, label: '题目' }")
    expect(source).toContain("{ value: 'submissions' as const, label: '提交记录' }")
    expect(source).not.toContain("{ value: 'problemList' as const, label: '题目列表' }")
    expect(source).toContain("{ value: 'attachments' as const, label: '附件' }")
    expect(source).toContain("{ value: 'attachments', label: '附件' }")
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
