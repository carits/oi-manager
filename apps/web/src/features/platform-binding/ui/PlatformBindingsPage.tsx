'use client'

import { publicErrorMessage } from '@/lib/humanErrors'
import { useState, useEffect, type CSSProperties } from 'react'
import collisionStyles from './PlatformBindingsPage.collision.module.css'
import unifiedStyles from './PlatformBindingsPage.module.css'
import { Input, Textarea } from '@/components/ui/FormControls'
import { FormDialog } from '@/components/ui/Dialogs'
import { Button } from '@/components/ui/Button'
import type { PlatformBinding, PlatformBindingConfig, PlatformBindingField } from '@oi-manager/contracts'
import { bindPlatform, getPlatformBindingConfig, listPlatformBindings, listPlatformBindingPlatforms, unbindPlatform } from '../api/platformBindingApi'

const cssVariable = (name: string, value: string): CSSProperties => ({ [name]: value })

export default function PlatformBindingsPage() {
  const [platforms, setPlatforms] = useState<PlatformBindingConfig[]>([])
  const [bindings, setBindings] = useState<Record<string, PlatformBinding>>({})
  const [loading, setLoading] = useState(true)
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformBindingConfig | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [configSchema, setConfigSchema] = useState<{ fields: PlatformBindingField[]; helpText: string } | null>(null)
  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [binding, setBinding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // 获取平台列表和绑定状态
  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      // 并行获取平台列表和绑定状态
      const [platformsResult, bindingsResult] = await Promise.all([
        listPlatformBindingPlatforms(),
        listPlatformBindings(),
      ])
      setPlatforms(platformsResult)
      {
        const map: Record<string, PlatformBinding> = {}
        bindingsResult.forEach((b) => {
          map[b.platform] = b
        })
        setBindings(map)
      }
    } catch (err) {
      setLoadError(publicErrorMessage(err, '平台绑定状态加载失败'))
    } finally {
      setLoading(false)
    }
  }

  const handlePlatformClick = async (platform: PlatformBindingConfig) => {
    setSelectedPlatform(platform)
    setError(null)
    setConfigValues({})

    // 如果平台支持绑定，获取配置 Schema
    if (platform.supported) {
      try {
        const result = await getPlatformBindingConfig(platform.id)
        if (result) {
          setConfigSchema(result)
          // 初始化配置值
          const initial: Record<string, string> = {}
          result.fields.forEach(f => {
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
      const requestBody: { platformUsername?: string; password?: string; extra?: Record<string, string> } = {}

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

      const result = await bindPlatform(selectedPlatform.id, requestBody)

      if (result.ok) {
        // 刷新绑定状态
        await fetchData()
        setModalOpen(false)
      } else {
        setError(result.error.userMessage)
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
      const result = await unbindPlatform(selectedPlatform.id)

      if (result.ok) {
        await fetchData()
        setModalOpen(false)
      } else {
        setError(result.error.userMessage)
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
      return { text: `已失效: ${binding.statusMessage || '请重新绑定'}`, color: 'var(--error)' }
    }
    return { text: '绑定失败', color: 'var(--error)' }
  }

  const currentBinding = selectedPlatform ? bindings[selectedPlatform.id] : null

  return (
    <>
      <div className={unifiedStyles.u1}>
        <h2 className={unifiedStyles.u2}>
          平台绑定
        </h2>
        <p className={unifiedStyles.u3}>
          绑定您的 OJ 平台账号，以便同步题目和成绩数据
        </p>

        {loadError && (
          <div className={unifiedStyles.u20} role="alert">
            <span>{loadError}</span>
            <Button size="sm" variant="outline" onClick={() => void fetchData()}>
              重新加载
            </Button>
          </div>
        )}

        {loading ? (
          <div className={unifiedStyles.u4}>
            <span className={[("resource-skeleton-line"), collisionStyles.u1].filter(Boolean).join(' ')}  aria-label="内容正在准备" />
          </div>
        ) : (
          <div className={unifiedStyles.u5}>
            {platforms.map((platform) => {
              const status = getBindingStatus(platform.id)
              return (
                <Button variant="ghost"
                  type="button"
                  key={platform.id}
                  onClick={() => handlePlatformClick(platform)}
                  className={unifiedStyles.platformCard}
                  disabled={!platform.supported}
                >
                  <div className={unifiedStyles.u6}>
                    <div className={unifiedStyles.platformIcon} style={cssVariable('--platform-color', platform.color)}>
                      {platform.name.charAt(0)}
                    </div>
                    <div>
                      <div className={unifiedStyles.u7}>
                        {platform.name}
                        {!platform.supported && (
                          <span className={unifiedStyles.u8}>
                            (暂不支持)
                          </span>
                        )}
                      </div>
                      <div className={unifiedStyles.bindingStatus} style={cssVariable('--binding-status-color', status.color)}>{status.text}</div>
                    </div>
                  </div>
                  <span className={unifiedStyles.u9}>▶</span>
                </Button>
              )
            })}
          </div>
        )}
      </div>

      {/* 绑定弹窗 */}
      <FormDialog
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`绑定 ${selectedPlatform?.name || ''} 账号`}
        size="md"
        loading={binding}
        dirty={Object.values(configValues).some(Boolean)}
      >
        <div className={unifiedStyles.u1}>
          {/* 平台图标 */}
          <div className={unifiedStyles.u10}>
            <div className={unifiedStyles.platformIconLarge} style={cssVariable('--platform-color', selectedPlatform?.color || 'var(--border)')}>
              {selectedPlatform?.name.charAt(0)}
            </div>
          </div>

          {/* 当前绑定状态 */}
          {currentBinding?.bindingStatus === 'bound' && (
            <div
              className={unifiedStyles.u11}
            >
              已绑定: {currentBinding.platformUsername}
            </div>
          )}

          {!selectedPlatform?.supported ? (
            <div className={unifiedStyles.u12}>
              <p className={unifiedStyles.u13}>该平台绑定功能暂未开放</p>
              <p className={unifiedStyles.u14}>敬请期待</p>
            </div>
          ) : configSchema ? (
            <>
              {/* 配置表单 */}
              {configSchema.fields.map((field) => (
                <div key={field.key} className={unifiedStyles.u15}>
                  <label
                    className={unifiedStyles.u16}
                  >
                    {field.label}
                    {field.required && <span className={unifiedStyles.u17}>*</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <Textarea
                      rows={4}
                      value={configValues[field.key] || ''}
                      onChange={(e) => setConfigValues({ ...configValues, [field.key]: e.target.value })}
                      placeholder={field.placeholder}
                      className={unifiedStyles.u18}
                    />
                  ) : (
                    <Input
                      type={field.type}
                      value={configValues[field.key] || ''}
                      onChange={(e) => setConfigValues({ ...configValues, [field.key]: e.target.value })}
                      placeholder={field.placeholder}
                      className={unifiedStyles.u18}
                    />
                  )}
                </div>
              ))}

              {/* 帮助文本 */}
              <p
                className={unifiedStyles.u19}
              >
                {configSchema.helpText}
              </p>
            </>
          ) : null}

          {/* 错误信息 */}
          {error && (
            <div
              className={unifiedStyles.u20}
            >
              {error}
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className={unifiedStyles.u21}>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>
            取消
          </Button>
          {currentBinding?.bindingStatus === 'bound' && (
            <Button variant="danger" onClick={handleUnbind} loading={binding}>
              解除绑定
            </Button>
          )}
          {selectedPlatform?.supported && currentBinding?.bindingStatus !== 'bound' && (
            <Button onClick={handleBind} loading={binding}>
              验证绑定
            </Button>
          )}
        </div>
      </FormDialog>
    </>
  )
}
