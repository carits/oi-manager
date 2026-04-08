'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'

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
}

interface ProblemNoteProps {
  role: 'teacher' | 'student' | 'admin'
  problemId: string
}

export function ProblemNote({ role, problemId }: ProblemNoteProps) {
  const router = useRouter()
  const toast = useToast()

  // 获取路径前缀
  const getPathPrefix = () => {
    if (role === 'admin') return '/platform-admin'
    if (role === 'student') return '/student'
    return '/teacher'
  }
  const pathPrefix = getPathPrefix()

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
        apiClient.get(`/api/problems/${problemId}/note`)
      ])

      if (problemRes.success && problemRes.data) {
        setProblem(problemRes.data)
      } else {
        toast.error('题目不存在')
        router.back()
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

  const getDifficultyColor = (difficulty: string | null) => {
    switch (difficulty) {
      case '简单': return '#10b981'
      case '中等': return '#f59e0b'
      case '困难': return '#ef4444'
      default: return 'var(--gray-500)'
    }
  }

  if (loading) {
    return (
      <div style={{ height: '100vh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--gray-500)' }}>加载中...</span>
      </div>
    )
  }

  if (!problem) return null

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f5' }}>
      {/* 顶部栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.5rem 1rem',
        background: 'white',
        borderBottom: '1px solid var(--border)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => router.back()}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--gray-600)',
              cursor: 'pointer',
              fontSize: '0.875rem',
              padding: '0.25rem 0.5rem',
              borderRadius: '4px'
            }}
          >
            ← 返回
          </button>
          <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />
          <span style={{ color: 'var(--primary)', fontWeight: 500, fontSize: '0.8rem' }}>{problem.problemId}</span>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{problem.title}</h1>
          {problem.difficulty && (
            <span style={{
              fontSize: '0.7rem',
              padding: '0.125rem 0.375rem',
              borderRadius: '4px',
              background: problem.difficulty === '简单' ? '#d1fae5' : problem.difficulty === '中等' ? '#fef3c7' : '#fee2e2',
              color: getDifficultyColor(problem.difficulty)
            }}>
              {problem.difficulty}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            padding: '0.25rem 0.5rem',
            borderRadius: '4px',
            background: noteSaving ? '#fef3c7' : noteLastSaved ? '#d1fae5' : 'transparent',
            fontSize: '0.75rem',
            color: noteSaving ? '#92400e' : noteLastSaved ? '#166534' : 'var(--gray-400)',
            minWidth: '100px',
            textAlign: 'center'
          }}>
            {noteSaving ? (
              <span>⏳ 保存中...</span>
            ) : noteLastSaved ? (
              <span>✓ 已保存 {noteLastSaved.toLocaleTimeString()}</span>
            ) : (
              <span>输入后自动保存</span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={noteSaving}
            style={{
              padding: '0.375rem 0.875rem',
              background: noteSaving ? 'var(--gray-300)' : '#8b5cf6',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: noteSaving ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem',
              fontWeight: 500
            }}
          >
            {noteSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      {/* 主内容区 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: '0.5rem', gap: '0.5rem' }}>
        {/* 左侧：题目描述 */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: 'white',
          borderRadius: '6px',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '0.5rem 0.75rem',
            background: '#fafafa',
            borderBottom: '1px solid var(--border)',
            fontWeight: 500,
            fontSize: '0.8rem',
            color: 'var(--gray-600)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span>📖</span>
            <span>题目描述</span>
            <div style={{ flex: 1 }} />
            {problem.timeLimit && <span style={{ fontSize: '0.7rem', color: 'var(--gray-400)' }}>时间: {problem.timeLimit}s</span>}
            {problem.memoryLimit && <span style={{ fontSize: '0.7rem', color: 'var(--gray-400)' }}>内存: {problem.memoryLimit}MB</span>}
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
            {problem.statementType === 'markdown' && problem.description ? (
              <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}>
                <MarkdownRenderer content={problem.description} />
              </div>
            ) : problem.statementType === 'pdf' && problem.statementPdfUrl ? (
              <object data={getPdfUrl(problem.statementPdfUrl) || ''} type="application/pdf" style={{ width: '100%', height: '100%', border: 'none' }}>
                <a href={getPdfUrl(problem.statementPdfUrl) || '#'} target="_blank">打开 PDF</a>
              </object>
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📄</div>
                <p>暂无题目描述</p>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：思路记录 */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: 'white',
          borderRadius: '6px',
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '0.5rem 0.75rem',
            background: '#fafafa',
            borderBottom: '1px solid var(--border)',
            fontWeight: 500,
            fontSize: '0.8rem',
            color: 'var(--gray-600)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span>✏️</span>
            <span>思路记录</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setEditMode('edit')} style={{ padding: '0.2rem 0.5rem', border: 'none', borderRadius: '3px', background: editMode === 'edit' ? 'var(--primary)' : 'transparent', color: editMode === 'edit' ? 'white' : 'var(--gray-500)', cursor: 'pointer', fontSize: '0.7rem' }}>编辑</button>
            <button onClick={() => setEditMode('preview')} style={{ padding: '0.2rem 0.5rem', border: 'none', borderRadius: '3px', background: editMode === 'preview' ? 'var(--primary)' : 'transparent', color: editMode === 'preview' ? 'white' : 'var(--gray-500)', cursor: 'pointer', fontSize: '0.7rem' }}>预览</button>
            <button onClick={() => setEditMode('split')} style={{ padding: '0.2rem 0.5rem', border: 'none', borderRadius: '3px', background: editMode === 'split' ? 'var(--primary)' : 'transparent', color: editMode === 'split' ? 'white' : 'var(--gray-500)', cursor: 'pointer', fontSize: '0.7rem' }}>分栏</button>
          </div>

          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {(editMode === 'edit' || editMode === 'split') && (
              <textarea
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
                style={{
                  flex: editMode === 'split' ? 1 : undefined,
                  width: editMode === 'edit' ? '100%' : undefined,
                  minHeight: '100%',
                  padding: '0.75rem',
                  border: 'none',
                  fontSize: '0.85rem',
                  fontFamily: 'Consolas, Monaco, monospace',
                  lineHeight: 1.6,
                  resize: 'none',
                  background: editMode === 'split' ? '#fafafa' : 'white',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
                spellCheck={false}
              />
            )}

            {editMode === 'split' && <div style={{ width: '1px', background: 'var(--border)' }} />}

            {(editMode === 'preview' || editMode === 'split') && (
              <div style={{
                flex: editMode === 'split' ? 1 : undefined,
                width: editMode === 'preview' ? '100%' : undefined,
                minHeight: '100%',
                padding: '0.75rem',
                overflow: 'auto',
                background: 'white',
                boxSizing: 'border-box'
              }}>
                {noteContent.trim() ? (
                  <div style={{ fontSize: '0.9rem', lineHeight: 1.8 }}>
                    <MarkdownRenderer content={noteContent} />
                  </div>
                ) : (
                  <div style={{ color: 'var(--gray-400)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
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