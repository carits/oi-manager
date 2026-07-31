'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'
import { LoadError } from '@/components/ui/LoadError'

interface ImportResultItem {
  lineNumber: number
  rawUsername: string
  matchType: string
  action: string
  result: 'success' | 'skipped' | 'error'
  studentId?: string
  studentName?: string
  errorMessage?: string
}

interface ImportResult {
  batchId: string
  totalProcessed: number
  invitedCount: number
  createdCount: number
  linkedCount: number
  skippedCount: number
  errorCount: number
  items: ImportResultItem[]
  batch?: {
    teamId: string
    platform: string
  }
}

export default function TeamImportResultPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const batchId = searchParams.get('batchId')

  const [result, setResult] = useState<ImportResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (batchId) {
      fetchResult()
    } else {
      setError('缺少导入批次参数')
      setLoading(false)
    }
  }, [batchId])

  const fetchResult = async () => {
    if (!batchId) return
    setLoading(true)
    setError(null)
    try {
      const res = await apiClient.get<ImportResult>(`/api/team-import/${batchId}/result`)
      if (res.success && res.data) {
        setResult(res.data)
      } else {
        setError(res.message || '导入结果读取失败')
      }
    } catch (err) {
      console.error('Failed to fetch result:', err)
      setError('导入结果读取失败')
    }
    setLoading(false)
  }

  const getResultText = (resultType: string) => {
    const map: Record<string, { text: string; color: string }> = {
      success: { text: '成功', color: 'var(--success)' },
      skipped: { text: '跳过', color: 'var(--gray-500)' },
      error: { text: '失败', color: 'var(--error)' },
    }
    return map[resultType] || { text: resultType, color: 'var(--gray-500)' }
  }

  if (loading) {
    return <PageLoadingFrame title="导入结果" />
  }

  if (error) {
    return (
      <LoadError
        message={error}
        onRetry={fetchResult}
        onBack={() => router.push('/teacher/students/import')}
      />
    )
  }

  if (!result) {
    return (
      <>
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>
          结果数据不存在
        </div>
      </>
    )
  }

  return (
    <>
      <div style={{ padding: '1rem 0' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          导入完成
        </h2>
        <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          共处理 {result.totalProcessed} 行数据
        </p>

        {/* 统计卡片 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ padding: '1rem', background: 'var(--primary-light, #eff6ff)', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--primary)' }}>
              {result.invitedCount}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>发送邀请</div>
          </div>
          <div style={{ padding: '1rem', background: 'var(--success-light, #d1fae5)', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--success)' }}>
              {result.createdCount}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>创建学生</div>
          </div>
          <div style={{ padding: '1rem', background: 'var(--gray-100)', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--gray-600)' }}>
              {result.linkedCount}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>关联账号</div>
          </div>
          <div style={{ padding: '1rem', background: 'var(--warning-light, #fef3c7)', borderRadius: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--warning)' }}>
              {result.skippedCount}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>跳过</div>
          </div>
          {result.errorCount > 0 && (
            <div style={{ padding: '1rem', background: 'var(--error-light, #fee2e2)', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--error)' }}>
                {result.errorCount}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-600)' }}>失败</div>
            </div>
          )}
        </div>

        {/* 说明 */}
        {result.invitedCount > 0 && (
          <div
            style={{
              padding: '1rem',
              background: 'var(--primary-light, #eff6ff)',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              fontSize: '0.875rem',
            }}
          >
            <strong>提示：</strong>已发送 {result.invitedCount} 条邀请，学生确认后即可加入团队。
          </div>
        )}

        {/* 详细结果表格 */}
        <details style={{ marginBottom: '1.5rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.75rem' }}>
            查看详细结果
          </summary>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>行号</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>平台用户名</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>处理结果</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>学生</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>备注</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => {
                  const resultInfo = getResultText(item.result)
                  return (
                    <tr key={item.lineNumber} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.75rem' }}>{item.lineNumber}</td>
                      <td style={{ padding: '0.75rem' }}>{item.rawUsername}</td>
                      <td style={{ padding: '0.75rem' }}>
                        <span
                          style={{
                            padding: '0.25rem 0.5rem',
                            borderRadius: '4px',
                            background: `${resultInfo.color}20`,
                            color: resultInfo.color,
                            fontSize: '0.75rem',
                          }}
                        >
                          {resultInfo.text}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem' }}>{item.studentName || '-'}</td>
                      <td style={{ padding: '0.75rem', fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                        {item.errorMessage || '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant="secondary" onClick={() => router.push('/teacher/students')}>
            返回学生管理
          </Button>
          <Button onClick={() => router.push('/teacher/students/import')}>
            继续导入
          </Button>
        </div>
      </div>
    </>
  )
}
