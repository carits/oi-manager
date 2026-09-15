'use client'

import { useState } from 'react'
import unifiedStyles from './NewProblemListPage.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/features/auth'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import apiClient from '@/lib/apiClient'
import { FormField } from '@/components/ui/FormField'

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
        router.push(`${pathPrefix}/problem-lists/${(res.data as { id: string }).id}`)
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
          <FormField label="题单标题" required>
            <Input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="请输入题单标题"
              required
              autoFocus
            />
          </FormField>

          <FormField label="题单描述">
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              placeholder="请输入题单描述（选填）"
            />
          </FormField>

          <div className={unifiedStyles.u6}>
            <Button variant="primary"
              type="submit"
              disabled={loading || !title.trim()}
              className={unifiedStyles.submitButton}
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
