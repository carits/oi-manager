'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import apiClient from '@/lib/apiClient'
import { formStyles } from '@/lib/styles'

export default function NewProblemListPage() {
  const router = useRouter()
  const { user } = useAuth()
  const pathPrefix = user?.role === 'student' ? '/student' : '/teacher'

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setLoading(true)
    try {
      const res = await apiClient.post('/api/problem-lists', {
        title: title.trim(),
        description: description.trim() || undefined,
      })
      if (res.success && res.data) {
        router.push(`${pathPrefix}/problem-lists/${(res.data as any).id}`)
      }
    } catch (e) {
      console.error('Failed to create', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '2rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <button
          onClick={() => router.back()}
          style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.875rem', padding: 0 }}
        >
          ← 返回题单列表
        </button>
      </div>

      <div style={{ background: 'white', borderRadius: '8px', border: '1px solid var(--border)', padding: '1.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>新建题单</h2>

        <form onSubmit={handleSubmit}>
          <div style={formStyles.field}>
            <label style={formStyles.label}>题单标题 *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="请输入题单标题"
              required
              autoFocus
              style={formStyles.input}
            />
          </div>

          <div style={formStyles.field}>
            <label style={formStyles.label}>题单描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              placeholder="请输入题单描述（选填）"
              style={formStyles.textarea}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              style={{
                flex: 1,
                padding: '0.625rem',
                background: loading || !title.trim() ? 'var(--gray-300)' : 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 500,
                cursor: loading || !title.trim() ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? '创建中...' : '创建题单'}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              style={{
                flex: 1,
                padding: '0.625rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'white',
                cursor: 'pointer'
              }}
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
