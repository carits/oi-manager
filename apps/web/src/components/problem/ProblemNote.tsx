'use client'

import { useState, useEffect, useRef } from 'react'
import collisionStyles from './ProblemNote.collision.module.css'
import unifiedStyles from './ProblemNote.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { usePathname, useRouter } from 'next/navigation'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'
import { Pencil } from 'lucide-react'
import { currentWorkspacePrefix } from '@/lib/workspacePath'

const getPdfUrl = (path: string | null) => {
  if (!path) return null
  // 绝对外部 URL 直接返回
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  // /api/files/:id/public → 通过 Next.js 同域代理加载（避免跨域 iframe 被拒）
  const fileMatch = path.match(/\/api\/files\/([^/]+)\/public/)
  if (fileMatch) {
    return `/api/files/download/${fileMatch[1]}?public=true`
  }
  // /api/files/:id/download → 通过 Next.js 同域代理加载
  const dlMatch = path.match(/\/api\/files\/([^/]+)\/download/)
  if (dlMatch) {
    return `/api/files/download/${dlMatch[1]}`
  }
  // /uploads/ 路径 → 通过 Next.js 同域代理加载
  if (path.startsWith('/uploads/')) {
    return `/api/problems/pdf-proxy?path=${encodeURIComponent(path)}`
  }
  return path
}

interface Statement {
  id: string
  format: 'markdown' | 'pdf'
  language: 'zh' | 'en' | null
  content: string | null
  fileUrl: string | null
  isVisible: boolean
}

interface Problem {
  id: string
  problemId: string
  platform: string
  title: string
  description: string | null
  statementType: string
  statementPdfUrl: string | null
  difficulty: string | null
  timeLimit: number | null
  memoryLimit: number | null
  statements: Statement[]
}

interface ProblemNoteProps {
  role: 'teacher' | 'student' | 'admin'
  problemId: string
}

export function ProblemNote({ role, problemId }: ProblemNoteProps) {
  const router = useRouter()
  const pathname = usePathname()
  const toast = useToast()

  // 获取路径前缀
  const pathPrefix = currentWorkspacePrefix(pathname, role === 'admin' ? '/platform-admin' : '/personal')

  const [problem, setProblem] = useState<Problem | null>(null)
  const [noteContent, setNoteContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteLastSaved, setNoteLastSaved] = useState<Date | null>(null)
  const [editMode, setEditMode] = useState<'edit' | 'preview' | 'split'>('split')

  const isFirstLoad = useRef(true)
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    loadData()
  }, [problemId])

  const loadData = async () => {
    try {
      setLoading(true)
      const [problemRes, noteRes] = await Promise.all([
        apiClient.get<Problem>(`/api/problems/${problemId}`),
        apiClient.get<any>(`/api/problems/${problemId}/note`)
      ])

      if (problemRes.success && problemRes.data) {
        setProblem(problemRes.data)
      } else {
        toast.error('题目不存在')
        router.push(`${pathPrefix}/problems`)
        return
      }

      if (noteRes.success && noteRes.data) {
        setNoteContent(noteRes.data.content || '')
        if (noteRes.data.content) {
          isFirstLoad.current = false
        }
      }
    } catch (error) {
      console.error('Load error:', error)
      router.push(`${pathPrefix}/problems`)
    } finally {
      setLoading(false)
    }
  }

  const saveToServer = async (content: string) => {
    try {
      setNoteSaving(true)
      const result = await apiClient.put(`/api/problems/${problemId}/note`, { content })
      if (result.success) {
        setNoteLastSaved(new Date())
      }
    } catch (error) {
      console.error('Save error:', error)
    } finally {
      setNoteSaving(false)
    }
  }

  const handleSave = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    saveToServer(noteContent)
  }

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      return
    }

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(() => {
      saveToServer(noteContent)
    }, 2000)

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [noteContent])

  // beforeunload protection
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (noteSaving) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [noteSaving])

  if (loading) {
    return (
      <div className={unifiedStyles.u1}>
        <span className={unifiedStyles.u2}><span className={[("resource-skeleton-line"), collisionStyles.u1].filter(Boolean).join(' ')}  aria-label="内容正在准备" /></span>
      </div>
    )
  }

  if (!problem) return null

  return (
    <div className={unifiedStyles.u3}>
      {/* 顶部栏 */}
      <div className={unifiedStyles.u4}>
        <div className={unifiedStyles.u5}>
          <Button variant="ghost"
            onClick={() => router.push(`${pathPrefix}/problems/${problemId}`)}
            className={unifiedStyles.u6}
          >
            ← 返回
          </Button>
          <div className={unifiedStyles.u7} />
          <span className={unifiedStyles.u8}>{problem.problemId}</span>
          <h1 className={unifiedStyles.u9}>{problem.title}</h1>
          {problem.difficulty && (
            <span className={unifiedStyles.difficultyBadge} data-difficulty={problem.difficulty}>
              {problem.difficulty}
            </span>
          )}
        </div>
        <div className={unifiedStyles.u5}>
          <div className={`${unifiedStyles.saveStatus} ${noteSaving ? unifiedStyles.savePending : noteLastSaved ? unifiedStyles.saveComplete : ''}`}>
            {noteSaving ? (
              <span>⏳ 保存中...</span>
            ) : noteLastSaved ? (
              <span>✓ 已保存 {noteLastSaved.toLocaleTimeString()}</span>
            ) : (
              <span>输入后自动保存</span>
            )}
          </div>
          <Button variant="primary" size="sm"
            onClick={handleSave}
            disabled={noteSaving}
          >
            {noteSaving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {/* 主内容区 */}
      <div className={unifiedStyles.u10}>
        {/* 左侧：题目描述 */}
        <div className={unifiedStyles.u11}>
          <div className={unifiedStyles.u12}>
            <span>📖</span>
            <span>题目描述</span>
            <div className={unifiedStyles.u13} />
            {problem.timeLimit && <span className={unifiedStyles.u14}>时间: {problem.timeLimit}ms</span>}
            {problem.memoryLimit && <span className={unifiedStyles.u14}>内存: {problem.memoryLimit}MB</span>}
          </div>
          <div className={unifiedStyles.u15}>
            {(() => {
              // 优先使用新的多版本题面
              const visibleStatements = (problem.statements || []).filter(s => s.isVisible)
              const stmt = visibleStatements.find(s => s.format === 'markdown' && s.language === 'zh')
                || visibleStatements.find(s => s.format === 'markdown')
                || visibleStatements[0]

              if (stmt) {
                if (stmt.format === 'pdf' && stmt.fileUrl) {
                  return (
                    <object data={getPdfUrl(stmt.fileUrl) || ''} type="application/pdf" className={unifiedStyles.u16}>
                      <a href={getPdfUrl(stmt.fileUrl) || '#'} target="_blank">打开 PDF</a>
                    </object>
                  )
                }
                if (stmt.content) {
                  return (
                    <div className={unifiedStyles.u17}>
                      <MarkdownRenderer content={stmt.content} />
                    </div>
                  )
                }
              }

              // 回退到旧字段
              if (problem.statementType === 'markdown' && problem.description) {
                return (
                  <div className={unifiedStyles.u17}>
                    <MarkdownRenderer content={problem.description} />
                  </div>
                )
              }
              if (problem.statementType === 'pdf' && problem.statementPdfUrl) {
                return (
                  <object data={getPdfUrl(problem.statementPdfUrl) || ''} type="application/pdf" className={unifiedStyles.u16}>
                    <a href={getPdfUrl(problem.statementPdfUrl) || '#'} target="_blank">打开 PDF</a>
                  </object>
                )
              }

              return (
                <div className={unifiedStyles.u18}>
                  <div className={unifiedStyles.u19}>📄</div>
                  <p>暂无题目描述</p>
                </div>
              )
            })()}
          </div>
        </div>

        {/* 右侧：思路记录 */}
        <div className={unifiedStyles.u11}>
          <div className={unifiedStyles.u12}>
            <Pencil aria-hidden="true" size={14} />
            <span>思路记录</span>
            <div className={unifiedStyles.u13} />
            <Button variant="ghost" onClick={() => setEditMode('edit')} className={unifiedStyles.modeButton} aria-pressed={editMode === 'edit'}>编辑</Button>
            <Button variant="ghost" onClick={() => setEditMode('preview')} className={unifiedStyles.modeButton} aria-pressed={editMode === 'preview'}>预览</Button>
            <Button variant="ghost" onClick={() => setEditMode('split')} className={unifiedStyles.modeButton} aria-pressed={editMode === 'split'}>分栏</Button>
          </div>

          <div className={unifiedStyles.u20}>
            {(editMode === 'edit' || editMode === 'split') && (
              <Textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder={`在这里记录你的解题思路...

例如：
## 题目分析
这道题的核心问题是...

## 思路过程
1. 首先考虑暴力解法...
2. 发现可以优化...

## 代码实现
\`\`\`cpp
// 核心代码
\`\`\`

## 复杂度分析
- 时间复杂度：O(n)
- 空间复杂度：O(n)`}
                className={`${unifiedStyles.noteEditor} ${editMode === 'split' ? unifiedStyles.splitPane : unifiedStyles.fullPane}`}
                spellCheck={false}
              />
            )}

            {editMode === 'split' && <div className={unifiedStyles.u21} />}

            {(editMode === 'preview' || editMode === 'split') && (
              <div className={`${unifiedStyles.notePreview} ${editMode === 'split' ? unifiedStyles.splitPane : unifiedStyles.fullPane}`}>
                {noteContent.trim() ? (
                  <div className={unifiedStyles.u17}>
                    <MarkdownRenderer content={noteContent} />
                  </div>
                ) : (
                  <div className={unifiedStyles.u22}>
                    暂无内容，开始编辑...
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
