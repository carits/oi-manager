import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('assignment productization contract', () => {
  const workspace = fs.readFileSync(new URL('./AssignmentWorkspace.tsx', import.meta.url), 'utf8')

  it('uses a four-step draft flow with advanced settings kept optional', () => {
    expect(workspace).toContain("['基本信息', '选择题目', '选择学生', '检查并发布']")
    expect(workspace).toContain('展开高级设置')
    expect(workspace).toContain('发布后立即可见')
  })

  it('renders an explicit student-by-problem matrix and manual completion action', () => {
    expect(workspace).toContain('caption="学生题目批改矩阵"')
    expect(workspace).toContain('等待学生首次提交后')
    expect(workspace).toContain('manualCompletionVersion')
    expect(workspace).toContain('撤销确认')
  })

  it('uses the shared code editor and gives the student a next action', () => {
    expect(workspace).toContain('<SubmissionCodeEditor')
    expect(workspace).toContain('下一步行动')
    expect(workspace).toContain('待订正')
  })
})
