'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'

export default function TeamImportInputPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const platform = searchParams.get('platform')
  const createTeam = searchParams.get('createTeam') || 'yes'
  const visibility = searchParams.get('visibility') || 'public'

  const [rawData, setRawData] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!rawData.trim()) {
      setError('请输入要导入的数据')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const requestBody: Record<string, any> = {
        platform,
        createTeam,
        rawData,
      }
      if (createTeam === 'yes') {
        requestBody.visibility = visibility
      }

      const result = await apiClient.post<any>('/api/team-import/start', requestBody)

      if (result.success && result.data) {
        // 跳转到预览页
        router.push(
          `/teacher/students/import/preview?batchId=${result.data.batchId}`
        )
      } else {
        setError(result.message || '导入失败')
      }
    } catch (err) {
      setError('网络错误，请稍后重试')
    }

    setSubmitting(false)
  }

  const platformNames: Record<string, string> = {
    vjudge: 'VJudge',
    luogu: '洛谷',
  }

  const exampleData = `user1 张三
user2
user3 李四`

  return (
    <ProtectedRoute requiredRole={['teacher', 'school_principal']}>
      <div style={{ padding: '1rem 0' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          输入导入数据 - {platformNames[platform || '']}
        </h2>
        <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          粘贴平台用户名，系统会自动解析并匹配学生
        </p>

        <div style={{ marginBottom: '1.5rem' }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.875rem',
              fontWeight: 500,
              marginBottom: '0.5rem',
              color: 'var(--gray-700)',
            }}
          >
            导入数据
          </label>
          <textarea
            value={rawData}
            onChange={(e) => setRawData(e.target.value)}
            placeholder="每行一个平台用户名，或每行「用户名 姓名」"
            style={{
              width: '100%',
              height: '300px',
              padding: '0.75rem',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '0.875rem',
              resize: 'vertical',
              boxSizing: 'border-box',
              fontFamily: 'monospace',
            }}
          />
        </div>

        {/* 数据格式说明 */}
        <div
          style={{
            padding: '1rem',
            background: 'var(--gray-50)',
            borderRadius: '8px',
            marginBottom: '1.5rem',
          }}
        >
          <h4 style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
            数据格式说明
          </h4>
          <ul style={{ fontSize: '0.75rem', color: 'var(--gray-600)', margin: 0, paddingLeft: '1.25rem' }}>
            <li>每行一个平台用户名</li>
            <li>或每行「用户名,姓名」（逗号分隔）</li>
            <li>或每行「用户名 姓名」（空格分隔）</li>
          </ul>
          <pre
            style={{
              marginTop: '0.75rem',
              padding: '0.5rem',
              background: 'white',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontFamily: 'monospace',
            }}
          >
            {exampleData}
          </pre>
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
          <Button variant="secondary" onClick={() => router.back()}>
            上一步
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '解析中...' : '下一步'}
          </Button>
        </div>
      </div>
    </ProtectedRoute>
  )
}