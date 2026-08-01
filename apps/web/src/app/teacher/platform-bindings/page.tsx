'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'
import styles from '@/components/platformBindings.module.css'

// 平台配置
const PLATFORMS = [
  { id: 'vjudge', name: 'Vjudge', color: '#4A90A4' },
  { id: 'luogu', name: '洛谷', color: '#3498db' },
  { id: 'codeforces', name: 'Codeforces', color: '#1f8dd6' },
  { id: 'atcoder', name: 'AtCoder', color: 'var(--text-primary)' },
]

interface PlatformBinding {
  id: string
  platform: string
  platformUsername: string | null
  bindingStatus: 'unbound' | 'pending' | 'bound' | 'failed' | 'expired'
  statusMessage?: string | null
  verifiedAt: string | null
}

interface ConfigField {
  key: string
  label: string
  type: 'text' | 'password' | 'textarea'
  required: boolean
  placeholder?: string
}

interface ConfigSchema {
  fields: ConfigField[]
  helpText?: string
}

export default function TeacherPlatformBindingsPage() {
  const [bindings, setBindings] = useState<Record<string, PlatformBinding>>({})
  const [loading, setLoading] = useState(true)
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [configSchema, setConfigSchema] = useState<ConfigSchema | null>(null)
  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 获取绑定状态
  useEffect(() => {
    fetchBindings()
  }, [])

  const fetchBindings = async () => {
    try {
      const result = await apiClient.get<PlatformBinding[]>('/api/platform-bindings')
      if (result.success && result.data) {
        // 转换为 { platform: binding } 格式
        const map: Record<string, PlatformBinding> = {}
        result.data.forEach((b) => {
          map[b.platform] = b
        })
        setBindings(map)
      }
    } catch (error) {
      console.error('Failed to fetch bindings:', error)
    }
    setLoading(false)
  }

  const handlePlatformClick = async (platformId: string) => {
    setSelectedPlatform(platformId)
    setError(null)
    setConfigValues({})
    setConfigSchema(null)

    // 获取平台配置 Schema
    try {
      const result = await apiClient.get<ConfigSchema>(`/api/platform-bindings/${platformId}/config-schema`)
      if (result.success && result.data) {
        setConfigSchema(result.data)
        // 初始化表单值
        const initial: Record<string, string> = {}
        result.data.fields.forEach((f) => {
          initial[f.key] = ''
        })
        setConfigValues(initial)
      }
    } catch (err) {
      console.error('Failed to fetch config schema:', err)
    }

    setModalOpen(true)
  }

  const getBindingStatus = (platformId: string) => {
    const binding = bindings[platformId]
    if (!binding || binding.bindingStatus === 'unbound') {
      return { text: '未绑定', color: 'var(--gray-500)' }
    }
    if (binding.bindingStatus === 'bound') {
      return { text: `已绑定: ${binding.platformUsername}`, color: 'var(--success)' }
    }
    if (binding.bindingStatus === 'expired') {
      return { text: `已失效: ${binding.statusMessage || '请重新绑定'}`, color: 'var(--error)' }
    }
    if (binding.bindingStatus === 'pending') {
      return { text: '绑定中...', color: 'var(--warning)' }
    }
    return { text: '绑定失败', color: 'var(--error)' }
  }

  const handleBind = async () => {
    if (!selectedPlatform) return

    // 验证必填字段
    if (configSchema) {
      for (const field of configSchema.fields) {
        if (field.required && !configValues[field.key]) {
          setError(`请填写 ${field.label}`)
          return
        }
      }
    }

    setSubmitting(true)
    setError(null)

    try {
      // 构建请求体：从 configValues 中提取 username 和 password
      const requestBody: any = {}

      // VJudge 等平台需要 platformUsername 和 password
      if (configValues.username) {
        requestBody.platformUsername = configValues.username
      }
      if (configValues.password) {
        requestBody.password = configValues.password
      }
      // 其他字段放入 extra
      const extraFields = { ...configValues }
      delete extraFields.username
      delete extraFields.password
      if (Object.keys(extraFields).length > 0) {
        requestBody.extra = extraFields
      }

      const result = await apiClient.post(`/api/platform-bindings/${selectedPlatform}/bind`, requestBody)

      if (result.success) {
        // 刷新绑定状态
        await fetchBindings()
        setModalOpen(false)
      } else {
        setError(result.message || '绑定失败')
      }
    } catch (err) {
      setError('网络错误，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUnbind = async () => {
    if (!selectedPlatform) return

    setSubmitting(true)
    setError(null)

    try {
      const result = await apiClient.delete(`/api/platform-bindings/${selectedPlatform}`)

      if (result.success) {
        await fetchBindings()
        setModalOpen(false)
      } else {
        setError(result.message || '解绑失败')
      }
    } catch (err) {
      setError('网络错误，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedPlatformInfo = PLATFORMS.find((p) => p.id === selectedPlatform)
  const currentBinding = selectedPlatform ? bindings[selectedPlatform] : null

  return (
    <>
      <div style={{ padding: '1rem 0' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          平台绑定
        </h2>
        <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          绑定您的 OJ 平台账号，以便同步题目和成绩数据
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>
            <span className="resource-skeleton-line" style={{ display: 'inline-block', width: '8rem' }} aria-label="内容正在准备" />
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem', maxWidth: '600px' }}>
            {PLATFORMS.map((platform) => {
              const status = getBindingStatus(platform.id)
              return (
                <button
                  type="button"
                  key={platform.id}
                  onClick={() => handlePlatformClick(platform.id)}
                  className={styles.platformCard}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '8px',
                        background: platform.color,
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 600,
                        fontSize: '0.875rem'
                      }}
                    >
                      {platform.name.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>{platform.name}</div>
                      <div style={{ fontSize: '0.875rem', color: status.color }}>{status.text}</div>
                    </div>
                  </div>
                  <span style={{ color: 'var(--gray-400)', fontSize: '0.875rem' }}>▶</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 绑定弹窗 */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`绑定 ${selectedPlatformInfo?.name || ''} 账号`}
        width="450px"
      >
        <div style={{ padding: '0.5rem 0' }}>
          {/* 平台图标 */}
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: 'var(--radius-lg)',
                background: selectedPlatformInfo?.color || 'var(--border)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                fontSize: '1.5rem',
                margin: '0 auto'
              }}
            >
              {selectedPlatformInfo?.name.charAt(0)}
            </div>
          </div>

          {/* 当前绑定状态 */}
          {currentBinding && currentBinding.bindingStatus === 'bound' && (
            <div style={{
              padding: '0.75rem 1rem',
              background: 'var(--success-bg, #dcfce7)',
              borderRadius: '6px',
              marginBottom: '1rem',
              color: 'var(--success, #16a34a)',
              fontSize: '0.875rem'
            }}>
              已绑定: {currentBinding.platformUsername}
            </div>
          )}

          {currentBinding && currentBinding.bindingStatus === 'expired' && (
            <div style={{
              padding: '0.75rem 1rem',
              background: 'var(--error-bg, #fee2e2)',
              borderRadius: '6px',
              marginBottom: '1rem',
              color: 'var(--error, #dc2626)',
              fontSize: '0.875rem'
            }}>
              已失效: {currentBinding.statusMessage || '请重新绑定'}
            </div>
          )}

          {/* 配置表单 */}
          {configSchema ? (
            <div>
              {configSchema.fields.map((field) => (
                <div key={field.key} style={{ marginBottom: '1rem' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    marginBottom: '0.5rem',
                    color: 'var(--gray-700)'
                  }}>
                    {field.label}
                    {field.required && <span style={{ color: 'var(--error)', marginLeft: '0.25rem' }}>*</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      value={configValues[field.key] || ''}
                      onChange={(e) => setConfigValues({ ...configValues, [field.key]: e.target.value })}
                      placeholder={field.placeholder}
                      rows={3}
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.75rem',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        fontSize: '0.875rem',
                        boxSizing: 'border-box',
                        resize: 'vertical',
                        fontFamily: 'monospace'
                      }}
                    />
                  ) : (
                    <input
                      type={field.type}
                      value={configValues[field.key] || ''}
                      onChange={(e) => setConfigValues({ ...configValues, [field.key]: e.target.value })}
                      placeholder={field.placeholder}
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.75rem',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        fontSize: '0.875rem',
                        boxSizing: 'border-box'
                      }}
                    />
                  )}
                </div>
              ))}

              {/* 帮助文本 */}
              {configSchema.helpText && (
                <div style={{
                  padding: '0.75rem 1rem',
                  background: 'var(--gray-50)',
                  borderRadius: '6px',
                  marginBottom: '1rem',
                  fontSize: '0.75rem',
                  color: 'var(--gray-600)',
                  lineHeight: 1.5
                }}>
                    {configSchema.helpText}
                  </div>
                )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--gray-500)' }}>
              <p>该平台绑定功能暂未开放，敬请期待</p>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div style={{
              padding: '0.75rem 1rem',
              background: 'var(--error-bg, #fee2e2)',
              borderRadius: '6px',
              marginBottom: '1rem',
              color: 'var(--error, #dc2626)',
              fontSize: '0.875rem',
              whiteSpace: 'pre-line',
              lineHeight: 1.6
            }}>
              {error}
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginTop: '1rem' }}>
          <div>
            {currentBinding && currentBinding.bindingStatus !== 'unbound' && (
              <Button
                variant="secondary"
                onClick={handleUnbind}
                disabled={submitting}
                style={{ color: 'var(--error)' }}
              >
                解除绑定
              </Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            {configSchema && (
              <Button onClick={handleBind} disabled={submitting}>
                {submitting ? '验证中...' : '验证绑定'}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </>
  )
}
