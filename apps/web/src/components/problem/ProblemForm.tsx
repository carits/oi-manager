'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import apiClient from '@/lib/apiClient'

interface OjBinding {
  platform: string
  problemId: string
}

interface OjAttachment {
  filename: string
  downloadLink: string
}

const OJ_PLATFORMS = [
  { value: 'luogu', label: '洛谷' },
  { value: 'codeforces', label: 'CodeForces' },
  { value: 'atcoder', label: 'AtCoder' },
  { value: 'loj', label: 'LOJ' },
  { value: 'poj', label: 'POJ' },
  { value: 'hdu', label: 'HDU' },
  { value: 'spoj', label: 'SPOJ' },
  { value: 'uva', label: 'UVa' },
  { value: 'vijos', label: 'Vijos' },
  { value: 'bzoj', label: 'BZOJ' },
  { value: 'gym', label: 'Gym' },
  { value: 'other', label: '其他' }
]

interface ProblemFormProps {
  mode: 'create' | 'edit'
  role: 'teacher' | 'student' | 'admin'
  problemId?: string
}

export function ProblemForm({ mode, role, problemId }: ProblemFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(mode === 'edit')
  const [activeTab, setActiveTab] = useState<'statement' | 'solution' | 'settings' | 'attachments'>('statement')
  const [editMode, setEditMode] = useState<'edit' | 'preview'>('edit')

  // 附件状态
  const [attachments, setAttachments] = useState<any[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)

  // 获取路径前缀
  const getPathPrefix = () => {
    if (role === 'admin') return '/platform-admin'
    if (role === 'student') return '/student'
    return '/teacher'
  }
  const pathPrefix = getPathPrefix()

  // 表单状态
  const [form, setForm] = useState({
    title: '',
    difficulty: '',
    timeLimit: '',
    memoryLimit: '',
    statementType: 'none',
    description: '',
    solutionType: 'none',
    solutionMarkdown: '',
    solutionVisible: false,
    visibility: 'private',
    status: 'draft'
  })

  // PDF 文件状态
  const [statementPdf, setStatementPdf] = useState<File | null>(null)
  const [solutionPdf, setSolutionPdf] = useState<File | null>(null)
  // OJ 绑定状态
  const [ojBindings, setOjBindings] = useState<OjBinding[]>([])
  // OJ 拉取状态
  const [fetchingFromOj, setFetchingFromOj] = useState(false)
  // 远程附件（从 OJ 拉取的附件）
  const [remoteAttachments, setRemoteAttachments] = useState<OjAttachment[]>([])
  const [downloadingAttachment, setDownloadingAttachment] = useState<string | null>(null)

  useEffect(() => {
    if (mode === 'edit' && problemId) {
      fetchProblem()
      fetchAttachments()
    }
  }, [mode, problemId])

  const fetchProblem = async () => {
    try {
      setLoading(true)
      const result = await apiClient.get<any>(`/api/problems/${problemId}`)
      if (result.success && result.data) {
        const p = result.data
        setForm({
          title: p.title,
          difficulty: p.difficulty || '',
          timeLimit: p.timeLimit?.toString() || '',
          memoryLimit: p.memoryLimit?.toString() || '',
          statementType: p.statementType,
          description: p.description || '',
          solutionType: p.solutionType,
          solutionMarkdown: p.solutionMarkdown || '',
          solutionVisible: p.solutionVisible,
          visibility: p.visibility || 'private',
          status: p.status
        })
        if (p.ojBindings) {
          setOjBindings(JSON.parse(p.ojBindings))
        }
      }
    } catch (error) {
      console.error('Failed to fetch problem:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAttachments = async () => {
    if (!problemId) return
    try {
      setAttachmentsLoading(true)
      const result = await apiClient.get<any[]>(`/api/problems/${problemId}/attachments`)
      if (result.success && result.data) {
        setAttachments(result.data)
      }
    } catch (error) {
      console.error('Failed to fetch attachments:', error)
    } finally {
      setAttachmentsLoading(false)
    }
  }

  const handleChange = (field: string, value: string | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleFileChange = (field: 'statement' | 'solution', file: File | null) => {
    if (field === 'statement') {
      setStatementPdf(file)
      if (file) handleChange('statementType', 'pdf')
    } else {
      setSolutionPdf(file)
      if (file) handleChange('solutionType', 'pdf')
    }
  }

  const addOjBinding = () => {
    if (ojBindings.length < 3) {
      setOjBindings([...ojBindings, { platform: '', problemId: '' }])
    }
  }

  const removeOjBinding = (index: number) => {
    setOjBindings(ojBindings.filter((_, i) => i !== index))
  }

  const updateOjBinding = (index: number, field: 'platform' | 'problemId', value: string) => {
    const updated = [...ojBindings]
    updated[index][field] = value
    setOjBindings(updated)
  }

  // 从 OJ 拉取题目信息
  const handleFetchFromOj = async (index: number) => {
    const binding = ojBindings[index]
    if (!binding.platform || !binding.problemId.trim()) {
      alert('请先选择平台并输入题号')
      return
    }

    try {
      setFetchingFromOj(true)
      const result = await apiClient.get<any>(`/api/oj-fetcher/${binding.platform}/${binding.problemId.trim()}`)

      if (result.success && result.data) {
        const problem = result.data
        // 自动填充表单
        setForm(prev => ({
          ...prev,
          title: problem.title || prev.title,
          description: problem.description || prev.description,
          timeLimit: problem.timeLimit ? String(problem.timeLimit) : prev.timeLimit,
          memoryLimit: problem.memoryLimit ? String(problem.memoryLimit) : prev.memoryLimit,
          difficulty: problem.difficulty || prev.difficulty,
          statementType: problem.description ? 'markdown' : prev.statementType
        }))

        // 处理附件
        if (problem.attachments && problem.attachments.length > 0) {
          setRemoteAttachments(problem.attachments)
          alert(`已拉取题目：${problem.title}\n发现 ${problem.attachments.length} 个附件，请在附件标签页下载`)
        } else {
          alert(`已拉取题目：${problem.title}`)
        }
      }
    } catch (error: any) {
      console.error('Failed to fetch from OJ:', error)
      const message = error?.response?.data?.error?.message || error?.message || '拉取失败'
      alert(message)
    } finally {
      setFetchingFromOj(false)
    }
  }

  // 下载远程附件
  const handleDownloadRemoteAttachment = async (attachment: OjAttachment) => {
    if (!problemId) {
      alert('请先保存题目后再下载附件')
      return
    }

    try {
      setDownloadingAttachment(attachment.filename)
      const result = await apiClient.post('/api/oj-fetcher/download-attachment', {
        problemId,
        url: attachment.downloadLink,
        filename: attachment.filename,
      })

      if (result.success) {
        // 从远程附件列表中移除已下载的
        setRemoteAttachments(prev => prev.filter(a => a.filename !== attachment.filename))
        // 刷新附件列表
        fetchAttachments()
        alert(`附件 "${attachment.filename}" 下载成功`)
      } else {
        alert(result.message || '下载失败')
      }
    } catch (error: any) {
      console.error('Failed to download attachment:', error)
      alert(error?.response?.data?.message || '下载失败')
    } finally {
      setDownloadingAttachment(null)
    }
  }

  // 上传附件
  const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !problemId) return

    try {
      setUploadingAttachment(true)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('description', '')

      // 注意：不要手动设置 Content-Type，让浏览器自动设置 boundary
      const result = await apiClient.post(`/api/problems/${problemId}/attachments`, formData)

      if (result.success) {
        fetchAttachments()
      } else {
        console.error('Upload failed:', result.message)
        alert(result.message || '上传失败')
      }
    } catch (error) {
      console.error('Failed to upload attachment:', error)
      alert('上传失败')
    } finally {
      setUploadingAttachment(false)
      e.target.value = '' // 重置input
    }
  }

  // 删除附件
  const handleAttachmentDelete = async (attachmentId: string) => {
    if (!confirm('确定要删除这个附件吗？')) return

    try {
      const result = await apiClient.delete(`/api/problems/${problemId}/attachments/${attachmentId}`)
      if (result.success) {
        fetchAttachments()
      }
    } catch (error) {
      console.error('Failed to delete attachment:', error)
      alert('删除失败')
    }
  }

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!form.title.trim()) {
      alert('请输入题目标题')
      return
    }

    try {
      setSaving(true)

      const data: any = {
        title: form.title.trim(),
        difficulty: form.difficulty || null,
        timeLimit: form.timeLimit ? parseInt(form.timeLimit) : null,
        memoryLimit: form.memoryLimit ? parseInt(form.memoryLimit) : null,
        statementType: form.statementType,
        solutionType: form.solutionType,
        solutionVisible: form.solutionVisible,
        status: form.status
      }

      if (form.description) data.description = form.description
      if (form.solutionMarkdown) data.solutionMarkdown = form.solutionMarkdown

      // 只有管理员可以设置 visibility
      if (role === 'admin') {
        data.visibility = form.visibility
      }

      const validBindings = ojBindings.filter(b => b.platform && b.problemId.trim())
      if (validBindings.length > 0) {
        data.ojBindings = validBindings
      }

      let result
      if (mode === 'create') {
        result = await apiClient.post('/api/problems', data)
      } else {
        result = await apiClient.put(`/api/problems/${problemId}`, data)
      }

      if (result.success && result.data) {
        const createdId = result.data.id || problemId

        // 上传 PDF 文件
        if (statementPdf && createdId) {
          const formData = new FormData()
          formData.append('file', statementPdf)
          await apiClient.post(`/api/problems/${createdId}/statement-pdf`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          })
        }
        if (solutionPdf && createdId) {
          const formData = new FormData()
          formData.append('file', solutionPdf)
          await apiClient.post(`/api/problems/${createdId}/solution-pdf`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          })
        }

        router.push(`${pathPrefix}/problems/${createdId}`)
      }
    } catch (error) {
      console.error('Failed to save problem:', error)
      alert('保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        加载中...
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem' }}>
        {/* 返回按钮 */}
        <button
          onClick={() => router.back()}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--primary)',
            cursor: 'pointer',
            marginBottom: '1rem',
            fontSize: '0.875rem'
          }}
        >
          ← 返回
        </button>

        <form onSubmit={handleSubmit}>
          {/* 基本信息 */}
          <div style={{
            background: 'white',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            padding: '1.5rem',
            marginBottom: '1.5rem'
          }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>
              {mode === 'create' ? '新建题目' : '编辑题目'}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>标题 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '0.875rem'
                  }}
                  placeholder="请输入题目标题"
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>难度</label>
                <select
                  value={form.difficulty}
                  onChange={(e) => handleChange('difficulty', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '0.875rem'
                  }}
                >
                  <option value="">请选择</option>
                  <option value="简单">简单</option>
                  <option value="中等">中等</option>
                  <option value="困难">困难</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>时间限制</label>
                <input
                  type="number"
                  value={form.timeLimit}
                  onChange={(e) => handleChange('timeLimit', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '0.875rem'
                  }}
                  placeholder="1000"
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>ms</span>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>空间限制</label>
                <input
                  type="number"
                  value={form.memoryLimit}
                  onChange={(e) => handleChange('memoryLimit', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '0.875rem'
                  }}
                  placeholder="256"
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>MB</span>
              </div>
            </div>
          </div>

          {/* Tab 切换 */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
            <button type="button" onClick={() => setActiveTab('statement')}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'statement' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'statement' ? 'var(--primary)' : 'var(--gray-500)'
              }}>
              题面
            </button>
            <button type="button" onClick={() => setActiveTab('solution')}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'solution' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'solution' ? 'var(--primary)' : 'var(--gray-500)'
              }}>
              题解
            </button>
            <button type="button" onClick={() => setActiveTab('settings')}
              style={{
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: activeTab === 'settings' ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '0.875rem',
                color: activeTab === 'settings' ? 'var(--primary)' : 'var(--gray-500)'
              }}>
              发布设置
            </button>
            {mode === 'edit' && (
              <button type="button" onClick={() => setActiveTab('attachments')}
                style={{
                  padding: '0.75rem 1rem',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: activeTab === 'attachments' ? '2px solid var(--primary)' : '2px solid transparent',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  color: activeTab === 'attachments' ? 'var(--primary)' : 'var(--gray-500)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem'
                }}>
                附件
                {attachments.length > 0 && (
                  <span style={{
                    background: 'var(--primary)',
                    color: 'white',
                    fontSize: '0.75rem',
                    padding: '0.125rem 0.375rem',
                    borderRadius: '10px',
                    minWidth: '18px',
                    textAlign: 'center'
                  }}>
                    {attachments.length}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Tab 内容 */}
          <div style={{
            background: 'white',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            padding: '1.5rem',
            marginBottom: '1.5rem'
          }}>
            {activeTab === 'statement' && (
              <div>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>题面类型</label>
                  <select
                    value={form.statementType}
                    onChange={(e) => handleChange('statementType', e.target.value)}
                    style={{
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '0.875rem'
                    }}
                  >
                    <option value="none">无</option>
                    <option value="markdown">Markdown</option>
                    <option value="pdf">PDF</option>
                  </select>
                </div>

                {form.statementType === 'markdown' && (
                  <div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <button type="button" onClick={() => setEditMode('edit')}
                        style={{
                          padding: '0.25rem 0.75rem',
                          border: '1px solid var(--border)',
                          borderRadius: '4px',
                          background: editMode === 'edit' ? 'var(--primary)' : 'white',
                          color: editMode === 'edit' ? 'white' : 'var(--gray-600)',
                          cursor: 'pointer',
                          fontSize: '0.75rem'
                        }}>
                        编辑
                      </button>
                      <button type="button" onClick={() => setEditMode('preview')}
                        style={{
                          padding: '0.25rem 0.75rem',
                          border: '1px solid var(--border)',
                          borderRadius: '4px',
                          background: editMode === 'preview' ? 'var(--primary)' : 'white',
                          color: editMode === 'preview' ? 'white' : 'var(--gray-600)',
                          cursor: 'pointer',
                          fontSize: '0.75rem'
                        }}>
                        预览
                      </button>
                    </div>
                    {editMode === 'edit' ? (
                      <textarea
                        value={form.description}
                        onChange={(e) => handleChange('description', e.target.value)}
                        style={{
                          width: '100%',
                          minHeight: '400px',
                          padding: '0.75rem',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                          fontFamily: 'monospace'
                        }}
                        placeholder="请输入题面内容（支持 Markdown 和 LaTeX）"
                      />
                    ) : (
                      <div style={{
                        minHeight: '400px',
                        padding: '1rem',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        overflow: 'auto'
                      }}>
                        {form.description ? (
                          <MarkdownRenderer content={form.description} />
                        ) : (
                          <span style={{ color: 'var(--gray-400)' }}>暂无内容</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {form.statementType === 'pdf' && (
                  <div>
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => handleFileChange('statement', e.target.files?.[0] || null)}
                      style={{ fontSize: '0.875rem' }}
                    />
                    {statementPdf && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.5rem' }}>
                        已选择: {statementPdf.name}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'solution' && (
              <div>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>题解类型</label>
                  <select
                    value={form.solutionType}
                    onChange={(e) => handleChange('solutionType', e.target.value)}
                    style={{
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '0.875rem'
                    }}
                  >
                    <option value="none">无</option>
                    <option value="markdown">Markdown</option>
                    <option value="pdf">PDF</option>
                  </select>
                </div>

                {form.solutionType === 'markdown' && (
                  <textarea
                    value={form.solutionMarkdown}
                    onChange={(e) => handleChange('solutionMarkdown', e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: '300px',
                      padding: '0.75rem',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontFamily: 'monospace'
                    }}
                    placeholder="请输入题解内容（支持 Markdown 和 LaTeX）"
                  />
                )}

                {form.solutionType === 'pdf' && (
                  <div>
                    <input
                      type="file"
                      accept=".pdf"
                      onChange={(e) => handleFileChange('solution', e.target.files?.[0] || null)}
                      style={{ fontSize: '0.875rem' }}
                    />
                    {solutionPdf && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.5rem' }}>
                        已选择: {solutionPdf.name}
                      </p>
                    )}
                  </div>
                )}

                <div style={{ marginTop: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form.solutionVisible}
                      onChange={(e) => handleChange('solutionVisible', e.target.checked)}
                    />
                    <span style={{ fontSize: '0.875rem' }}>题解对学生可见</span>
                  </label>
                </div>
              </div>
            )}

            {activeTab === 'settings' && (
              <div>
                {/* 管理员可选择可见性 */}
                {role === 'admin' && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>可见性</label>
                    <select
                      value={form.visibility}
                      onChange={(e) => handleChange('visibility', e.target.value)}
                      style={{
                        padding: '0.5rem',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        fontSize: '0.875rem'
                      }}
                    >
                      <option value="private">私有（仅自己可见）</option>
                      <option value="public">公共（所有人可见）</option>
                    </select>
                  </div>
                )}

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>状态</label>
                  <select
                    value={form.status}
                    onChange={(e) => handleChange('status', e.target.value)}
                    style={{
                      padding: '0.5rem',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '0.875rem'
                    }}
                  >
                    <option value="draft">草稿</option>
                    <option value="published">已发布</option>
                  </select>
                </div>

                {/* OJ 绑定 */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>OJ 题目绑定</label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.75rem' }}>
                    绑定外部OJ题目，最多可添加3个
                  </p>

                  {ojBindings.map((binding, index) => (
                    <div key={index} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                      <select
                        value={binding.platform}
                        onChange={(e) => updateOjBinding(index, 'platform', e.target.value)}
                        style={{
                          padding: '0.5rem',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          fontSize: '0.875rem'
                        }}
                      >
                        <option value="">选择平台</option>
                        {OJ_PLATFORMS.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={binding.problemId}
                        onChange={(e) => updateOjBinding(index, 'problemId', e.target.value)}
                        placeholder="题号"
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          fontSize: '0.875rem'
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleFetchFromOj(index)}
                        disabled={fetchingFromOj || !binding.platform || !binding.problemId.trim()}
                        style={{
                          padding: '0.5rem 0.75rem',
                          border: '1px solid var(--primary)',
                          borderRadius: '6px',
                          background: 'white',
                          color: 'var(--primary)',
                          cursor: fetchingFromOj ? 'not-allowed' : 'pointer',
                          fontSize: '0.75rem',
                          opacity: fetchingFromOj ? 0.5 : 1
                        }}
                      >
                        {fetchingFromOj ? '拉取中...' : '拉取'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeOjBinding(index)}
                        style={{
                          padding: '0.5rem 0.75rem',
                          border: '1px solid #ef4444',
                          borderRadius: '6px',
                          background: 'white',
                          color: '#ef4444',
                          cursor: 'pointer',
                          fontSize: '0.75rem'
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ))}

                  {ojBindings.length < 3 && (
                    <button
                      type="button"
                      onClick={addOjBinding}
                      style={{
                        padding: '0.5rem 1rem',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        background: 'white',
                        cursor: 'pointer',
                        fontSize: '0.875rem'
                      }}
                    >
                      + 添加绑定
                    </button>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'attachments' && (
              <div>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>上传附件</label>
                  <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.75rem' }}>
                    支持 PDF、ZIP、RAR、7Z、TXT、CPP、C、PY、JAVA、PAS、IN、OUT、MD 格式，最大 50MB
                  </p>
                  <input
                    type="file"
                    accept=".pdf,.zip,.rar,.7z,.txt,.cpp,.c,.py,.java,.pas,.in,.out,.md"
                    onChange={handleAttachmentUpload}
                    disabled={uploadingAttachment}
                    style={{ fontSize: '0.875rem' }}
                  />
                  {uploadingAttachment && <span style={{ marginLeft: '0.5rem', fontSize: '0.875rem', color: 'var(--gray-500)' }}>上传中...</span>}
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>已上传附件</label>
                  {attachmentsLoading ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>加载中...</div>
                  ) : attachments.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>暂无附件</div>
                  ) : (
                    <div>
                      {attachments.map((attachment) => (
                        <div
                          key={attachment.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.75rem 1rem',
                            borderBottom: '1px solid var(--border)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <span style={{ fontSize: '1.25rem' }}>📎</span>
                            <div>
                              <div style={{ fontWeight: 500 }}>{attachment.fileName}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                                {formatFileSize(attachment.fileSize)}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAttachmentDelete(attachment.id)}
                            style={{
                              padding: '0.375rem 0.75rem',
                              border: '1px solid #ef4444',
                              background: 'white',
                              color: '#ef4444',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.875rem'
                            }}
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 远程附件（从 OJ 拉取的附件） */}
                {remoteAttachments.length > 0 && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                      远程附件（从 OJ 拉取）
                    </label>
                    <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.75rem' }}>
                      以下附件来自 OJ 平台，点击下载后保存到本系统
                    </p>
                    <div>
                      {remoteAttachments.map((attachment, index) => (
                        <div
                          key={index}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.75rem 1rem',
                            borderBottom: '1px solid var(--border)',
                            background: '#fef3c7'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <span style={{ fontSize: '1.25rem' }}>📥</span>
                            <div>
                              <div style={{ fontWeight: 500 }}>{attachment.filename}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                                待下载
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDownloadRemoteAttachment(attachment)}
                            disabled={downloadingAttachment !== null}
                            style={{
                              padding: '0.375rem 0.75rem',
                              border: '1px solid var(--primary)',
                              background: downloadingAttachment === attachment.filename ? 'var(--gray-200)' : 'white',
                              color: 'var(--primary)',
                              borderRadius: '4px',
                              cursor: downloadingAttachment !== null ? 'not-allowed' : 'pointer',
                              fontSize: '0.875rem'
                            }}
                          >
                            {downloadingAttachment === attachment.filename ? '下载中...' : '下载'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 提交按钮 */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => router.back()}
              style={{
                padding: '0.5rem 1rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'white',
                cursor: 'pointer',
                fontSize: '0.875rem'
              }}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '0.5rem 1.5rem',
                border: 'none',
                borderRadius: '6px',
                background: 'var(--primary)',
                color: 'white',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '0.875rem',
                opacity: saving ? 0.7 : 1
              }}
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}