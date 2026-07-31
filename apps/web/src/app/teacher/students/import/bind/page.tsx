'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import apiClient from '@/lib/apiClient'

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

export default function TeamImportBindPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const platform = searchParams.get('platform')
  const createTeam = searchParams.get('createTeam') || 'yes'
  const visibility = searchParams.get('visibility') || 'public'

  const [configSchema, setConfigSchema] = useState<ConfigSchema | null>(null)
  const [configValues, setConfigValues] = useState<Record<string, string>>({})
  const [binding, setBinding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (platform) {
      fetchConfigSchema()
    }
  }, [platform])

  const fetchConfigSchema = async () => {
    try {
      const result = await apiClient.get<ConfigSchema>(
        `/api/platform-bindings/${platform}/config-schema`
      )
      if (result.success && result.data) {
        setConfigSchema(result.data)
        const initial: Record<string, string> = {}
        result.data.fields.forEach((f) => {
          initial[f.key] = ''
        })
        setConfigValues(initial)
      }
    } catch (err) {
      console.error('Failed to fetch config schema:', err)
    }
  }

  const handleBind = async () => {
    if (!platform) return

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
      const requestBody: any = {}

      if (configSchema && configValues) {
        if (configValues.username) {
          requestBody.platformUsername = configValues.username
        }
        if (configValues.password) {
          requestBody.password = configValues.password
        }
      }

      const result = await apiClient.post(
        `/api/platform-bindings/${platform}/bind`,
        requestBody
      )

      if (result.success) {
        // 绑定成功，跳转到输入页面
        const params = new URLSearchParams({ platform: platform || '', createTeam })
        if (createTeam === 'yes') {
          params.set('visibility', visibility)
        }
        router.push(`/teacher/students/import/input?${params.toString()}`)
      } else {
        setError(result.message || '绑定失败')
      }
    } catch (err) {
      setError('网络错误，请稍后重试')
    }

    setBinding(false)
  }

  const platformNames: Record<string, string> = {
    vjudge: 'VJudge',
    luogu: '洛谷',
  }

  return (
    <>
      <div style={{ padding: '1rem 0' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          绑定 {platformNames[platform || '']} 账号
        </h2>
        <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          您还没有绑定此平台，请先完成绑定
        </p>

        {configSchema ? (
          <div style={{ maxWidth: '400px' }}>
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
                  {field.required && (
                    <span style={{ color: 'var(--error)', marginLeft: '0.25rem' }}>*</span>
                  )}
                </label>
                <input
                  type={field.type}
                  value={configValues[field.key] || ''}
                  onChange={(e) =>
                    setConfigValues({ ...configValues, [field.key]: e.target.value })
                  }
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

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
              <Button variant="secondary" onClick={() => router.push('/teacher/students/import')}>
                返回
              </Button>
              <Button onClick={handleBind} disabled={binding}>
                {binding ? '绑定中...' : '绑定账号'}
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>
            <span className="resource-skeleton-line" style={{ display: 'inline-block', width: '8rem' }} aria-label="内容正在准备" />
          </div>
        )}
      </div>
    </>
  )
}