import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')

describe('workbench UX regressions', () => {
  it('protects training drafts and never treats unchecked child mutations as success', () => {
    const source = read('../features/contest/ui/TrainingFormModal.tsx')
    expect(source).toContain('useUnsavedChanges')
    expect(source).toContain('draftDirty')
    expect(source).toContain('requestClose')
    expect(source).toContain('requireSuccess')
    expect(source).toContain('mapWithConcurrency(newRows, 4')
    expect(source).toContain('createdIdByRow')
    expect(source).toContain('保存题目顺序失败')
  })

  it('keeps problem-list failures visible and uses optimistic reorder with rollback', () => {
    const source = read('../features/problem/ui/ProblemListDetailPage.tsx')
    expect(source).toContain('题单加载超时')
    expect(source).toContain('暂时无法连接服务器')
    expect(source).toContain('mapWithConcurrency(rowsToSave, 4')
    expect(source).toContain('setDetail(previous)')
    expect(source).toContain('调整顺序失败，已恢复原顺序')
    expect(source).toContain('已保留在编辑区，可直接重试')
  })

  it('protects statement drafts and avoids browser-native rename/delete prompts', () => {
    const source = read('../features/problem/ui/StatementVersionWorkspace.tsx')
    expect(source).toContain('useUnsavedChanges')
    expect(source).toContain('pendingDraftAction')
    expect(source).toContain('放弃未保存的题面修改？')
    expect(source).toContain('重命名题面')
    expect(source).toContain('删除题面版本？')
    expect(source).not.toContain('window.prompt')
    expect(source).not.toContain('window.confirm')
  })
})
