import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

describe('human UX productization contract', () => {
  it('uses a simple training flow and keeps coach controls optional', () => {
    const source = read('./training-engine/TrainingSessionListPage.tsx')
    expect(source).toContain('普通训练（推荐）')
    expect(source).toContain('教练带练模式')
    expect(source).toContain('选择题目')
    expect(source).toContain('requiredProblemCount')
    expect(source).toContain('trainingStatusLabel(item.status)')
    expect(source).toContain('trainingSessionTypeLabel(item.sessionType)')
    expect(source).not.toContain('>{item.status}</StatusBadge>')
  })

  it('treats a team as an activity container instead of another workspace', () => {
    const source = read('./team/TeamDetailPage.tsx')
    expect(source).toContain('<TeamActivityOverview')
    expect(source).toContain('<TeamMemberList')
    expect(source).not.toContain('TeamProblemListsTab')
    expect(source).not.toContain('TeamTrainingList')
  })

  it('shows a teacher task inbox before secondary statistics', () => {
    const source = read('./organization-pages/teacher/page.tsx')
    expect(source).toContain('待处理事项')
    expect(source).toContain('加入申请')
    expect(source).toContain('作业')
    expect(source).toContain('训练')
  })

  it('uses an inline submission workbench and merges personal solutions', () => {
    const source = read('./problem/ProblemDetail.tsx')
    expect(source).toContain('aria-label="代码提交工作台"')
    expect(source).toContain('撰写我的题解')
    expect(source).toContain('label="题目更多内容"')
    expect(source).toContain('trigger={<Button variant="outline">管理题目</Button>}')
    expect(source).not.toContain("handleTabChange('my-content')")
    expect(source).not.toContain('同步远程记录')
  })

  it('keeps student views free of internal revision terminology', () => {
    const assignment = read('./assignment/AssignmentWorkspace.tsx')
    const training = read('./training-engine/TrainingSessionWorkspace.tsx')
    expect(assignment).toContain('作业发布时固定的数据评测')
    expect(training).toContain('使用训练发布时固定的数据评测')
    expect(assignment).not.toContain('TestSet Revision 与学生名单')
    expect(assignment).not.toContain('版本号并发校验')
    expect(assignment).not.toContain('成绩快照 v')
    expect(training).not.toContain('命令带 revision 审计')
  })

  it('renders quality conclusions and hides technical certificates by default', () => {
    const source = read('./problem/ProblemQualityPanel.tsx')
    expect(source).toContain('数据质量良好')
    expect(source).toContain('查看技术证书与评分细项')
  })

  it('does not ask users to type resource IDs in the data market', () => {
    const source = read('./data-market/DataMarketplace.tsx')
    expect(source).toContain('<ProblemRevisionPicker')
    expect(source).toContain('<LicenseScopePicker')
    expect(source).not.toContain('Problem ID')
    expect(source).not.toContain('组织 ID')
    expect(source).not.toContain('比赛 ID')
  })

  it('does not ask blog authors to paste internal database identifiers', () => {
    const source = read('./blog/BlogReferenceEditor.tsx')
    expect(source).toContain('<ProblemReferencePicker')
    expect(source).toContain('请到对应的题解、比赛榜单或 Rating 记录页面')
    expect(source).not.toContain('内部 ID')
    expect(source).not.toContain('Revision ID')
    expect(source).not.toContain('Snapshot ID')
  })

  it('uses school language in the school workspace and hides account internals', () => {
    const school = read('./organization-pages/teacher/school/components/HomeTab.tsx')
    const wallet = read('./wallet/WalletPage.tsx')
    expect(school).toContain('学校资产')
    expect(school).not.toContain('组织钱包')
    expect(wallet).toContain('我的钱包与评测额度')
    expect(wallet).toContain('使用详情与兑换记录')
    expect(wallet).toContain('学校贡献归属已记录')
  })

  it('uses human contribution language outside the manager-only technical view', () => {
    const source = read('./problem/ProblemHackPanel.tsx')
    expect(source).toContain('系统会依次检查输入是否合法')
    expect(source).toContain('贡献候选数据')
    expect(source).toContain('选择学校只用于贡献记录归属')
    expect(source).not.toContain('选择组织只用于声誉归因')
  })

  it('keeps archive import out of activity submission guidance', () => {
    const source = read('./training/TrainingDetailPage.tsx')
    expect(source).toContain('提交结果只计入当前活动')
    expect(source).not.toContain('远程提交记录可在题目页同步归档')
  })
})
