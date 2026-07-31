'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'

interface PlatformConfig {
  id: string
  name: string
  color: string
  supported: boolean
}

interface PlatformBinding {
  id: string
  platform: string
  platformUsername: string | null
  bindingStatus: 'unbound' | 'pending' | 'bound' | 'failed' | 'expired'
  verifiedAt: string | null
}

interface ConfigField {
  key: string
  label: string
  type: 'text' | 'password'
  required: boolean
  placeholder?: string
}

interface ConfigSchema {
  fields: ConfigField[]
  helpText: string
}

export default function AdminPlatformBindingsPage() {
  const [platforms, setPlatforms] = useState<PlatformConfig[]>([])
  const [bindings, setBindings] = useState<Record<string, PlatformBinding>>({})
  const [loading, setLoading] = useState(true)
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformConfig | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [configSchema, setConfigSchema] = useState<ConfigSchema | null>(null)
  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [binding, setBinding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 获取平台列表和绑定状态
  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      // 并行获取平台列表和绑定状态
      const [platformsRes, bindingsRes] = await Promise.all([
        apiClient.get<PlatformConfig[]>('/api/platform-bindings/platforms'),
        apiClient.get<PlatformBinding[]>('/api/platform-bindings'),
      ])

      if (platformsRes.success && platformsRes.data) {
        setPlatforms(platformsRes.data)
      }

      if (bindingsRes.success && bindingsRes.data) {
        const map: Record<string, PlatformBinding> = {}
        bindingsRes.data.forEach((b) => {
          map[b.platform] = b
        })
        setBindings(map)
      }
    } catch (err) {
      console.error('Failed to fetch data:', err)
    }
    setLoading(false)
  }

  const handlePlatformClick = async (platform: PlatformConfig) => {
    setSelectedPlatform(platform)
    setError(null)
    setConfigValues({})

    // 如果平台支持绑定，获取配置 Schema
    if (platform.supported) {
      try {
        const result = await apiClient.get<ConfigSchema>(`/api/platform-bindings/${platform.id}/config-schema`)
        if (result.success && result.data) {
          setConfigSchema(result.data)
          // 初始化配置值
          const initial: Record<string, string> = {}
          result.data.fields.forEach(f => {
            initial[f.key] = ''
          })
          setConfigValues(initial)
        } else {
          setConfigSchema(null)
        }
      } catch (err) {
        console.error('Failed to fetch config schema:', err)
        setConfigSchema(null)
      }
    } else {
      setConfigSchema(null)
    }

    setModalOpen(true)
  }

  const handleBind = async () => {
    if (!selectedPlatform) return

    // 验证必填字段
    if (configSchema) {
      for (const field of configSchema.fields) {
        if (field.required && !configValues[field.key]?.trim()) {
          setError(`请填写 ${field.label}`)
          return
        }
      }
    }

    setBinding(true)
    setError(null)

    try {
      // 构建请求体：从 configValues 中提取 username 和 password
      const requestBody: any = {}

      if (configSchema && configValues) {
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
      }

      const result = await apiClient.post(`/api/platform-bindings/${selectedPlatform.id}/bind`, requestBody)

      if (result.success) {
        // 刷新绑定状态
        await fetchData()
        setModalOpen(false)
      } else {
        setError(result.message || '绑定失败')
      }
    } catch (err) {
      setError('网络错误，请稍后重试')
    }

    setBinding(false)
  }

  const handleUnbind = async () => {
    if (!selectedPlatform) return

    setBinding(true)
    setError(null)

    try {
      const result = await apiClient.delete(`/api/platform-bindings/${selectedPlatform.id}`)

      if (result.success) {
        await fetchData()
        setModalOpen(false)
      } else {
        setError(result.message || '解绑失败')
      }
    } catch (err) {
      setError('网络错误，请稍后重试')
    }

    setBinding(false)
  }

  const getBindingStatus = (platformId: string) => {
    const binding = bindings[platformId]
    if (!binding || binding.bindingStatus === 'unbound') {
      return { text: '未绑定', color: 'var(--gray-500)' }
    }
    if (binding.bindingStatus === 'bound') {
      return { text: `已绑定: ${binding.platformUsername}`, color: 'var(--success)' }
    }
    if (binding.bindingStatus === 'pending') {
      return { text: '绑定中...', color: 'var(--warning)' }
    }
    if (binding.bindingStatus === 'expired') {
      return { text: '已失效', color: 'var(--error)' }
    }
    return { text: '绑定失败', color: 'var(--error)' }
  }

  const currentBinding = selectedPlatform ? bindings[selectedPlatform.id] : null

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
            {platforms.map((platform) => {
              const status = getBindingStatus(platform.id)
              return (
                <div
                  key={platform.id}
                  onClick={() => handlePlatformClick(platform)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1rem 1.5rem',
                    background: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    opacity: platform.supported ? 1 : 0.6,
                  }}
                  onMouseEnter={(e) => {
                    if (platform.supported) {
                      e.currentTarget.style.borderColor = 'var(--primary)'
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.1)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
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
                        fontSize: '0.875rem',
                      }}
                    >
                      {platform.name.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>
                        {platform.name}
                        {!platform.supported && (
                          <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                            (暂不支持)
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.875rem', color: status.color }}>{status.text}</div>
                    </div>
                  </div>
                  <span style={{ color: 'var(--gray-400)', fontSize: '0.875rem' }}>▶</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 绑定弹窗 */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`绑定 ${selectedPlatform?.name || ''} 账号`}
        width="450px"
      >
        <div style={{ padding: '1rem 0' }}>
          {/* 平台图标 */}
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: 'var(--radius-lg)',
                background: selectedPlatform?.color || 'var(--border)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                fontSize: '1.5rem',
                margin: '0 auto',
              }}
            >
              {selectedPlatform?.name.charAt(0)}
            </div>
          </div>

          {/* 当前绑定状态 */}
          {currentBinding?.bindingStatus === 'bound' && (
            <div
              style={{
                padding: '0.75rem 1rem',
                background: 'var(--success-light, #d1fae5)',
                borderRadius: '6px',
                marginBottom: '1rem',
                color: 'var(--success)',
              }}
            >
              已绑定: {currentBinding.platformUsername}
            </div>
          )}

          {!selectedPlatform?.supported ? (
            <div style={{ textAlign: 'center', color: 'var(--gray-500)' }}>
              <p style={{ margin: 0 }}>该平台绑定功能暂未开放</p>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem' }}>敬请期待</p>
            </div>
          ) : configSchema ? (
            <>
              {/* 配置表单 */}
              {configSchema.fields.map((field) => (
                <div key={field.key} style={{ marginBottom: '1rem' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      marginBottom: '0.5rem',
                      color: 'var(--gray-700)',
                    }}
                  >
                    {field.label}
                    {field.required && <span style={{ color: 'var(--error)', marginLeft: '0.25rem' }}>*</span>}
                  </label>
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
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}

              {/* 帮助文本 */}
              <p
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--gray-500)',
                  marginTop: '0.5rem',
                  lineHeight: 1.5,
                }}
              >
                {configSchema.helpText}
              </p>
            </>
          ) : null}

          {/* 错误信息 */}
          {error && (
            <div
              style={{
                padding: '0.75rem 1rem',
                background: 'var(--error-light, #fee2e2)',
                borderRadius: '6px',
                marginTop: '1rem',
                color: 'var(--error)',
                fontSize: '0.875rem',
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>
            取消
          </Button>
          {currentBinding?.bindingStatus === 'bound' && (
            <Button variant="secondary" onClick={handleUnbind} disabled={binding}>
              解除绑定
            </Button>
          )}
          {selectedPlatform?.supported && currentBinding?.bindingStatus !== 'bound' && (
            <Button onClick={handleBind} disabled={binding}>
              {binding ? '验证中...' : '验证绑定'}
            </Button>
          )}
        </div>
      </Modal>
    </>
  )
}