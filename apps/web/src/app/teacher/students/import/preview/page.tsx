'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'

interface ParsedRow {
  lineNumber: number
  rawUsername: string
  parsedUsername: string
  candidateDisplayName: string
  valid: boolean
  error?: string
}

interface MatchResult {
  lineNumber: number
  matchType: string
  matchedStudentId?: string
  matchedStudentName?: string
  suggestedAction: string
  canAutoProcess: boolean
  conflictReason?: string
}

interface PreviewData {
  batchId: string
  teamId: string
  platform: string
  totalRows: number
  parsedRows: ParsedRow[]
  matchResults: MatchResult[]
  summary: {
    newMembers: number
    existingMembers: number
    sameNameMatches: number
    conflicts: number
    invalidRows: number
  }
}

export default function TeamImportPreviewPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const batchId = searchParams.get('batchId')

  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [userChoices, setUserChoices] = useState<Record<number, { action: 'confirm' | 'skip'; createStudent?: boolean; studentName?: string }>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (batchId) {
      fetchPreview()
    }
  }, [batchId])

  const fetchPreview = async () => {
    try {
      const result = await apiClient.get<PreviewData>(`/api/team-import/${batchId}/preview`)
      if (result.success && result.data) {
        const data = result.data
        setPreview(data)
        // 初始化用户选择（默认全部确认）
        const initial: Record<number, { action: 'confirm' | 'skip'; createStudent?: boolean; studentName?: string }> = {}
        data.matchResults.forEach((m) => {
          if (m.matchType === 'new_member') {
            initial[m.lineNumber] = { action: 'confirm', createStudent: true, studentName: data.parsedRows.find(p => p.lineNumber === m.lineNumber)?.candidateDisplayName }
          } else if (m.matchType === 'invalid' || m.matchType === 'conflict') {
            initial[m.lineNumber] = { action: 'skip' }
          } else {
            initial[m.lineNumber] = { action: 'confirm' }
          }
        })
        setUserChoices(initial)
      }
    } catch (err) {
      console.error('Failed to fetch preview:', err)
    }
    setLoading(false)
  }

  const handleConfirm = async () => {
    if (!batchId) return

    setSubmitting(true)
    setError(null)

    try {
      const items = Object.entries(userChoices).map(([lineNumber, choice]) => ({
        lineNumber: parseInt(lineNumber),
        action: choice.action,
        createStudent: choice.createStudent,
        studentName: choice.studentName,
      }))

      const result = await apiClient.post(`/api/team-import/${batchId}/confirm`, { items })

      if (result.success) {
        router.push(`/teacher/students/import/result?batchId=${batchId}`)
      } else {
        setError(result.message || '导入失败')
      }
    } catch (err) {
      setError('网络错误，请稍后重试')
    }

    setSubmitting(false)
  }

  const getMatchTypeText = (type: string) => {
    const map: Record<string, { text: string; color: string }> = {
      new_member: { text: '新成员', color: 'var(--primary)' },
      existing_member: { text: '已有账号', color: 'var(--success)' },
      same_name: { text: '疑似同名', color: 'var(--warning)' },
      conflict: { text: '账号冲突', color: 'var(--error)' },
      invalid: { text: '无效数据', color: 'var(--gray-500)' },
    }
    return map[type] || { text: type, color: 'var(--gray-500)' }
  }

  const getActionText = (action: string) => {
    const map: Record<string, string> = {
      invite: '发送邀请',
      create_and_invite: '创建并发送邀请',
      link_only: '仅关联账号',
      skip: '跳过',
      manual_required: '需人工处理',
    }
    return map[action] || action
  }

  if (loading) {
    return (
      <ProtectedRoute requiredRole={['teacher', 'school_principal']}>
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>
          加载预览数据...
        </div>
      </ProtectedRoute>
    )
  }

  if (!preview) {
    return (
      <ProtectedRoute requiredRole={['teacher', 'school_principal']}>
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>
          预览数据不存在
        </div>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute requiredRole={['teacher', 'school_principal']}>
      <div style={{ padding: '1rem 0' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          预览导入结果
        </h2>
        <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          共 {preview.totalRows} 行数据，请确认处理方式
        </p>

        {/* 统计摘要 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ padding: '1rem', background: 'var(--primary-light, #eff6ff)', borderRadius: '8px' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--primary)' }}>
              {preview.summary.newMembers}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>新成员</div>
          </div>
          <div style={{ padding: '1rem', background: 'var(--success-light, #d1fae5)', borderRadius: '8px' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--success)' }}>
              {preview.summary.existingMembers}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>已有账号</div>
          </div>
          <div style={{ padding: '1rem', background: 'var(--warning-light, #fef3c7)', borderRadius: '8px' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--warning)' }}>
              {preview.summary.sameNameMatches}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>疑似同名</div>
          </div>
          <div style={{ padding: '1rem', background: 'var(--error-light, #fee2e2)', borderRadius: '8px' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--error)' }}>
              {preview.summary.conflicts}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>账号冲突</div>
          </div>
        </div>

        {/* 表格 */}
        <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>行号</th>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>平台用户名</th>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>候选显示名</th>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>匹配状态</th>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>匹配学生</th>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>建议动作</th>
                <th style={{ padding: '0.75rem', textAlign: 'center' }}>用户选择</th>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>创建学生</th>
              </tr>
            </thead>
            <tbody>
              {preview.matchResults.map((match, index) => {
                const parsed = preview.parsedRows[index]
                const choice = userChoices[match.lineNumber]
                const matchInfo = getMatchTypeText(match.matchType)

                return (
                  <tr key={match.lineNumber} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem' }}>{match.lineNumber}</td>
                    <td style={{ padding: '0.75rem' }}>{parsed?.parsedUsername || '-'}</td>
                    <td style={{ padding: '0.75rem' }}>{parsed?.candidateDisplayName || '-'}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <span
                        style={{
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          background: `${matchInfo.color}20`,
                          color: matchInfo.color,
                          fontSize: '0.75rem',
                        }}
                      >
                        {matchInfo.text}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      {match.matchedStudentName || '-'}
                    </td>
                    <td style={{ padding: '0.75rem', fontSize: '0.75rem', color: 'var(--gray-600)' }}>
                      {getActionText(match.suggestedAction)}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                      {match.matchType === 'invalid' || match.matchType === 'conflict' ? (
                        <span style={{ color: 'var(--gray-400)' }}>自动跳过</span>
                      ) : (
                        <select
                          value={choice?.action || 'confirm'}
                          onChange={(e) =>
                            setUserChoices({
                              ...userChoices,
                              [match.lineNumber]: {
                                ...choice,
                                action: e.target.value as 'confirm' | 'skip',
                              },
                            })
                          }
                          style={{
                            padding: '0.25rem 0.5rem',
                            border: '1px solid var(--border)',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                          }}
                        >
                          <option value="confirm">确认导入</option>
                          <option value="skip">跳过</option>
                        </select>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      {match.matchType === 'new_member' && choice?.action === 'confirm' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <input
                            type="checkbox"
                            checked={choice?.createStudent || false}
                            onChange={(e) =>
                              setUserChoices({
                                ...userChoices,
                                [match.lineNumber]: {
                                  ...choice,
                                  createStudent: e.target.checked,
                                },
                              })
                            }
                          />
                          {choice?.createStudent && (
                            <input
                              type="text"
                              value={choice?.studentName || ''}
                              onChange={(e) =>
                                setUserChoices({
                                  ...userChoices,
                                  [match.lineNumber]: {
                                    ...choice,
                                    studentName: e.target.value,
                                  },
                                })
                              }
                              placeholder="学生姓名"
                              style={{
                                padding: '0.25rem 0.5rem',
                                border: '1px solid var(--border)',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                width: '100px',
                              }}
                            />
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--error-light, #fee2e2)',
              borderRadius: '6px',
              marginBottom: '1rem',
              color: 'var(--error)',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant="secondary" onClick={() => router.push('/teacher/students/import')}>
            返回修改
          </Button>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? '处理中...' : '确认导入'}
          </Button>
        </div>
      </div>
    </ProtectedRoute>
  )
}