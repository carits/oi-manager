import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('assignment productization contract', () => {
  const workspace = fs.readFileSync(new URL('./ui/AssignmentWorkspace.tsx', import.meta.url), 'utf8')

  it('uses explicit draft section saves with advanced settings kept optional', () => {
    expect(workspace).toContain('保存基本信息</Button>')
    expect(workspace).toContain('保存题目</Button>')
    expect(workspace).toContain('保存学生名单</Button>')
    expect(workspace).toContain('saveBasicsChecked')
    expect(workspace).toContain('saveProblemsChecked')
    expect(workspace).toContain('saveRosterChecked')
    expect(workspace).toContain('展开高级设置')
    expect(workspace).toContain('发布后立即可见')
  })

  it('edits problem references as one replaceable table without restoring step navigation', () => {
    expect(workspace).toContain('ProblemListEditor')
    expect(workspace).toContain('onReplace={replaceProblems}')
    expect(workspace).not.toContain('designStep')
    expect(workspace).not.toContain('saveCurrentStep')
    expect(workspace).not.toContain('changeStep')
    expect(workspace).not.toContain('作业设计步骤')
    expect(workspace).not.toContain('点击“下一步”')
    expect(workspace).not.toContain('当前步骤已自动保存')
  })

  it('submits the displayed correction target and narrows filtered matrix columns', () => {
    expect(workspace).toContain('setCorrectionRequiredScore(assignment.Problems.find(problem => problem.id === cell.assignmentProblemId)?.targetScore || 0)')
    expect(workspace).toContain('requiredScore: correctionRequiredScore')
    expect(workspace).toContain('const matrixProblems = problemFilter')
    expect(workspace).toContain('...matrixProblems.map(problem =>')
  })

  it('renders an explicit student-by-problem matrix and manual completion action', () => {
    expect(workspace).toContain('caption="学生题目批改矩阵"')
    expect(workspace).toContain('className: styles.matrixSticky')
    expect(workspace).toContain('等待学生首次提交后')
    expect(workspace).toContain('manualCompletionVersion')
    expect(workspace).toContain('撤销确认')
  })

  it('uses the shared code editor and gives the student a next action', () => {
    expect(workspace).toContain('<SubmissionCodeEditor')
    expect(workspace).toContain('下一步行动')
    expect(workspace).toContain('待订正')
    expect(workspace).toContain('statementsSnapshot')
    expect(workspace).toContain('<MarkdownRenderer')
    expect(workspace).toContain('查看并提交')
    expect(workspace).toContain('源码草稿会保留')
    expect(workspace).not.toContain('clearSubmissionDraft')
    expect(workspace).not.toContain("setCode('')")
  })
})
