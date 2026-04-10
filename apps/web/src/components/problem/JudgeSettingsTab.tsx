'use client'

import { useState, useEffect, useRef } from 'react'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'

interface JudgeSettingsTabProps {
  problemId: string
  timeLimit: string
  memoryLimit: string
  onTimeLimitChange: (v: string) => void
  onMemoryLimitChange: (v: string) => void
}

interface TestdataFile {
  id: string
  filename: string
  size: number
  md5: string | null
  uploadedAt: string
}

interface TestdataPair {
  input: string
  output: string
}

interface JudgeConfig {
  type?: string
  time?: string
  memory?: string
  checker_type?: string
  checker?: string
  subtasks?: any[]
  cases?: any[]
}

const PROBLEM_TYPES = [
  { value: 'default', label: '传统题' },
  { value: 'interactive', label: '交互题' },
  { value: 'objective', label: '客观题' },
  { value: 'submit_answer', label: '提交答案题' },
  { value: 'communication', label: '通信题' }
]

const CHECKER_TYPES = [
  { value: 'default', label: '默认（全文比较，忽略行末空格和末尾空行）' },
  { value: 'strict', label: '严格（全文比较）' },
  { value: 'testlib', label: 'testlib（自定义校验器）' },
  { value: 'lemon', label: 'Lemon' },
  { value: 'hustoj', label: 'HUSTOJ' },
  { value: 'syzoj', label: 'SYZOJ' },
  { value: 'kattis', label: 'Kattis' }
]

export function JudgeSettingsTab({
  problemId,
  timeLimit,
  memoryLimit,
  onTimeLimitChange,
  onMemoryLimitChange
}: JudgeSettingsTabProps) {
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 状态
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problemType, setProblemType] = useState('default')
  const [checkerType, setCheckerType] = useState('default')
  const [testdataFiles, setTestdataFiles] = useState<TestdataFile[]>([])
  const [testdataPairs, setTestdataPairs] = useState<TestdataPair[]>([])
  const [uploading, setUploading] = useState(false)
  const [deletingFile, setDeletingFile] = useState<string | null>(null)

  // 加载评测配置
  useEffect(() => {
    if (problemId) {
      fetchJudgeConfig()
      fetchTestdata()
    }
  }, [problemId])

  const fetchJudgeConfig = async () => {
    try {
      setLoading(true)
      const result = await apiClient.get<any>(`/api/problems/${problemId}/judge-config`)
      if (result.success && result.data) {
        setProblemType(result.data.problemType || 'default')
        if (result.data.config) {
          setCheckerType(result.data.config.checker_type || 'default')
        }
      }
    } catch (error) {
      console.error('Failed to fetch judge config:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchTestdata = async () => {
    try {
      const result = await apiClient.get<any>(`/api/problems/${problemId}/testdata`)
      if (result.success && result.data) {
        setTestdataFiles(result.data.files || [])
        setTestdataPairs(result.data.pairs || [])
      }
    } catch (error) {
      console.error('Failed to fetch testdata:', error)
    }
  }

  const handleSaveConfig = async () => {
    try {
      setSaving(true)
      const config: JudgeConfig = {
        type: problemType,
        time: timeLimit ? `${timeLimit}s` : undefined,
        memory: memoryLimit ? `${memoryLimit}MB` : undefined,
        checker_type: checkerType
      }

      const result = await apiClient.put(`/api/problems/${problemId}/judge-config`, {
        problemType,
        timeLimit: timeLimit ? parseInt(timeLimit) : null,
        memoryLimit: memoryLimit ? parseInt(memoryLimit) : null,
        config
      })

      if (result.success) {
        toast.success('评测配置已保存')
      } else {
        toast.error(result.message || '保存失败')
      }
    } catch (error) {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    try {
      setUploading(true)
      const formData = new FormData()
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i])
      }

      const result = await apiClient.postFile(`/api/problems/${problemId}/testdata`, formData)
      if (result.success) {
        toast.success(`成功上传 ${files.length} 个文件`)
        fetchTestdata()
      } else {
        toast.error(result.message || '上传失败')
      }
    } catch (error) {
      toast.error('上传失败')
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleDeleteFile = async (fileId: string, filename: string) => {
    if (!confirm(`确定要删除 ${filename} 吗？`)) return

    try {
      setDeletingFile(fileId)
      const result = await apiClient.delete(`/api/problems/${problemId}/testdata/${fileId}`)
      if (result.success) {
        toast.success('文件已删除')
        fetchTestdata()
      } else {
        toast.error(result.message || '删除失败')
      }
    } catch (error) {
      toast.error('删除失败')
    } finally {
      setDeletingFile(null)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>
        加载中...
      </div>
    )
  }

  return (
    <div>
      {/* 基本配置 */}
      <div style={{
        marginBottom: '2rem',
        padding: '1.5rem',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        background: 'var(--gray-50)'
      }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--gray-800)' }}>
          基本配置
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
              题目类型
            </label>
            <select
              value={problemType}
              onChange={(e) => setProblemType(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              {PROBLEM_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
              校验器类型
            </label>
            <select
              value={checkerType}
              onChange={(e) => setCheckerType(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            >
              {CHECKER_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
              时间限制 (ms)
            </label>
            <input
              type="number"
              value={timeLimit}
              onChange={(e) => onTimeLimitChange(e.target.value)}
              placeholder="如 1000"
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
              内存限制 (MB)
            </label>
            <input
              type="number"
              value={memoryLimit}
              onChange={(e) => onMemoryLimitChange(e.target.value)}
              placeholder="如 256"
              style={{
                width: '100%',
                padding: '0.5rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            />
          </div>
        </div>

        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleSaveConfig}
            disabled={saving}
            style={{
              padding: '0.5rem 1.5rem',
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
              fontSize: '0.875rem'
            }}
          >
            {saving ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>

      {/* 测试数据管理 */}
      <div style={{
        padding: '1.5rem',
        border: '1px solid var(--border)',
        borderRadius: '8px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--gray-800)' }}>
            测试数据
          </h3>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <label style={{
              padding: '0.5rem 1rem',
              background: 'var(--primary)',
              color: 'white',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem'
            }}>
              {uploading ? '上传中...' : '上传文件'}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileUpload}
                accept=".in,.out,.ans,.txt"
                style={{ display: 'none' }}
                disabled={uploading}
              />
            </label>
          </div>
        </div>

        <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '1rem' }}>
          支持 .in, .out, .ans 文件。同名配对的 .in 和 .out/.ans 文件将自动识别为测试点。
        </p>

        {/* 自动识别的测试数据对 */}
        {testdataPairs.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--gray-700)' }}>
              已识别的测试点 ({testdataPairs.length} 个)
            </h4>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '0.5rem'
            }}>
              {testdataPairs.map((pair, index) => (
                <div key={index} style={{
                  padding: '0.5rem 0.75rem',
                  background: 'var(--gray-50)',
                  borderRadius: '4px',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}>
                  <span style={{ color: 'var(--success)', fontWeight: 500 }}>#{index + 1}</span>
                  <span style={{ color: 'var(--gray-600)' }}>{pair.input}</span>
                  <span style={{ color: 'var(--gray-400)' }}>→</span>
                  <span style={{ color: 'var(--gray-600)' }}>{pair.output}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 文件列表 */}
        {testdataFiles.length > 0 && (
          <div>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--gray-700)' }}>
              已上传文件 ({testdataFiles.length} 个)
            </h4>
            <div style={{
              border: '1px solid var(--border)',
              borderRadius: '6px',
              overflow: 'hidden'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: 'var(--gray-50)' }}>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>文件名</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>大小</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>上传时间</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {testdataFiles.map(file => (
                    <tr key={file.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace' }}>{file.filename}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--gray-500)' }}>{formatFileSize(file.size)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: 'var(--gray-500)' }}>
                        {new Date(file.uploadedAt).toLocaleString('zh-CN')}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                        <button
                          onClick={() => handleDeleteFile(file.id, file.filename)}
                          disabled={deletingFile === file.id}
                          style={{
                            padding: '0.25rem 0.5rem',
                            background: 'transparent',
                            color: 'var(--error)',
                            border: '1px solid var(--error)',
                            borderRadius: '4px',
                            cursor: deletingFile === file.id ? 'not-allowed' : 'pointer',
                            fontSize: '0.75rem',
                            opacity: deletingFile === file.id ? 0.5 : 1
                          }}
                        >
                          {deletingFile === file.id ? '删除中...' : '删除'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {testdataFiles.length === 0 && (
          <div style={{
            padding: '2rem',
            textAlign: 'center',
            color: 'var(--gray-400)',
            border: '2px dashed var(--border)',
            borderRadius: '6px'
          }}>
            暂无测试数据，请上传 .in 和 .out/.ans 文件
          </div>
        )}
      </div>
    </div>
  )
}