'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { useAuth } from '@/components/AuthProvider'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { getAuthHeaders } from '@/lib/auth'
import { ENV } from '@/config/env'

interface ContestProblem {
  id: string
  orderIndex: number
  title: string | null
  ojName: string | null
  problemId: string | null
  isCustom: boolean
  difficulty: string | null
  points: number | null
  statementType: 'none' | 'markdown' | 'pdf'
  statementMarkdown: string | null
}

interface Contest {
  id: string
  title: string
  contestDate: string
  status: string
  problems: ContestProblem[]
}

// 映射序号 A, B, C...
function getProblemLabel(index: number): string {
  return String.fromCharCode(65 + index)
}

export default function PracticePage() {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()

  const contestId = Array.isArray(params.id) ? params.id[0] : params.id
  const problemId = Array.isArray(params.problemId) ? params.problemId[0] : params.problemId

  const [contest, setContest] = useState<Contest | null>(null)
  const [problem, setProblem] = useState<ContestProblem | null>(null)
  const [loading, setLoading] = useState(true)

  // 笔记状态
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)

  // 获取比赛和题目信息
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        const res = await fetch(`${ENV.API_URL}/api/contests/${contestId}`, {
          headers: getAuthHeaders()
        })
        const data = await res.json()
        if (data.success) {
          setContest(data.data)
          const foundProblem = data.data.problems?.find(
            (p: ContestProblem) => p.id === problemId
          )
          setProblem(foundProblem || null)
        }
      } catch (error) {
        console.error('Fetch contest error:', error)
      } finally {
        setLoading(false)
      }
    }

    if (contestId && problemId) {
      fetchData()
    }
  }, [contestId, problemId])

  // 获取笔记内容
  useEffect(() => {
    const fetchNote = async () => {
      try {
        const res = await fetch(
          `${ENV.API_URL}/api/contests/${contestId}/problems/${problemId}/note`,
          { headers: getAuthHeaders() }
        )
        const data = await res.json()
        if (data.success && data.data) {
          setContent(data.data.content || '')
          setSavedContent(data.data.content || '')
        }
      } catch (error) {
        console.error('Fetch note error:', error)
      }
    }

    if (contestId && problemId && user?.role === 'student') {
      fetchNote()
    }
  }, [contestId, problemId, user])

  // 保存笔记
  const saveNote = useCallback(async (newContent: string) => {
    if (newContent === savedContent) return

    try {
      setSaving(true)
      const res = await fetch(
        `${ENV.API_URL}/api/contests/${contestId}/problems/${problemId}/note`,
        {
          method: 'PUT',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ content: newContent })
        }
      )
      const data = await res.json()
      if (data.success) {
        setSavedContent(newContent)
        setLastSaved(new Date())
      }
    } catch (error) {
      console.error('Save note error:', error)
    } finally {
      setSaving(false)
    }
  }, [contestId, problemId, savedContent])

  // 自动保存 (debounce 1秒)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (content !== savedContent && !saving) {
        saveNote(content)
      }
    }, 1000)

    return () => clearTimeout(timer)
  }, [content, savedContent, saving, saveNote])

  if (loading) {
    return (
      <ProtectedRoute requiredRole="student">
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          加载中...
        </div>
      </ProtectedRoute>
    )
  }

  if (!contest || !problem) {
    return (
      <ProtectedRoute requiredRole="student">
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          题目不存在
        </div>
      </ProtectedRoute>
    )
  }

  const problemIndex = contest.problems?.findIndex(p => p.id === problem.id) ?? 0

  return (
    <ProtectedRoute requiredRole="student">
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)', display: 'flex', flexDirection: 'column' }}>
        {/* 顶部标题栏 */}
        <div style={{
          padding: '0.75rem 1.5rem',
          background: 'white',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem'
        }}>
          <button
            onClick={() => router.push(`/student/contests/${contestId}`)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--gray-500)',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            ← 返回比赛
          </button>
          <div style={{ height: '1rem', width: '1px', background: 'var(--border)' }} />
          <span style={{ fontWeight: 500 }}>{contest.title}</span>
          <span style={{ color: 'var(--gray-500)' }}>|</span>
          <span style={{ color: 'var(--primary)', fontWeight: 500 }}>
            {getProblemLabel(problemIndex)}. {problem.isCustom ? problem.title : `${problem.ojName} ${problem.problemId}`}
          </span>
          {problem.points && (
            <span style={{ color: 'var(--gray-500)', fontSize: '0.875rem' }}>({problem.points}分)</span>
          )}
          <div style={{ flex: 1 }} />
          {/* 保存状态 */}
          <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
            {saving ? (
              <span>保存中...</span>
            ) : lastSaved ? (
              <span>已保存 {lastSaved.toLocaleTimeString()}</span>
            ) : null}
          </div>
        </div>

        {/* 主内容区域 - 分栏布局 */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* 左侧 - 题目描述 */}
          <div style={{
            flex: 1,
            padding: '1.5rem',
            overflow: 'auto',
            borderRight: '1px solid var(--border)',
            background: 'white'
          }}>
            <div style={{ maxWidth: '800px' }}>
              <h2 style={{
                fontSize: '1.25rem',
                fontWeight: 600,
                marginBottom: '1rem',
                paddingBottom: '0.75rem',
                borderBottom: '1px solid var(--border)'
              }}>
                题目描述
              </h2>

              {problem.statementType === 'markdown' && problem.statementMarkdown ? (
                <div
                  className="markdown-content"
                  style={{ fontSize: '0.9375rem', lineHeight: 1.8 }}
                  dangerouslySetInnerHTML={{ __html: problem.statementMarkdown }}
                />
              ) : problem.statementType === 'pdf' ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>
                  <p>该题目为 PDF 格式，请在比赛详情页的「资料下载」中查看</p>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}>
                  <p>暂无题目描述</p>
                </div>
              )}
            </div>
          </div>

          {/* 右侧 - 思路记录编辑器 */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            background: 'white'
          }}>
            <div style={{
              padding: '1rem 1.5rem',
              borderBottom: '1px solid var(--border)',
              fontWeight: 500
            }}>
              思路记录
            </div>
            <div style={{ flex: 1, padding: '1rem', overflow: 'hidden' }}>
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                <MarkdownEditor
                  value={content}
                  onChange={setContent}
                  placeholder="在这里记录你的解题思路...

支持 Markdown 格式：
- 使用 **粗体** 和 *斜体*
- 使用 - 创建列表
- 使用 ```代码块``
- 使用 $LaTeX$ 编写数学公式"
                  minHeight="calc(100vh - 200px)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}