'use client'

import { useState } from 'react'
import unifiedStyles from './NewProblemListPage.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import apiClient from '@/lib/apiClient'
import { formStyles } from '@/lib/styles'

export default function NewProblemListPage() {
  const router = useRouter()
  const { user } = useAuth()
  const pathname = usePathname()
  const pathPrefix = currentWorkspacePrefix(pathname, '/personal')

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
    <div className={unifiedStyles.u1}>
      <div className={unifiedStyles.u2}>
        <Button variant="ghost"
          onClick={() => router.push(`${pathPrefix}/problem-lists`)}
          className={unifiedStyles.u3}
        >
          ← 返回题单列表
        </Button>
      </div>

      <div className={unifiedStyles.u4}>
        <h2 className={unifiedStyles.u5}>新建题单</h2>

        <form onSubmit={handleSubmit}>
          <div style={formStyles.field}>
            <label style={formStyles.label}>题单标题 *</label>
            <Input
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
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              placeholder="请输入题单描述（选填）"
              style={formStyles.textarea}
            />
          </div>

          <div className={unifiedStyles.u6}>
            <Button variant="ghost"
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
            </Button>
            <Button variant="ghost"
              type="button"
              onClick={() => router.push(`${pathPrefix}/problem-lists`)}
              className={unifiedStyles.u7}
            >
              取消
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
