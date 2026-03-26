'use client'

import { useState, useEffect } from 'react'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'

// 平台配置
const PLATFORMS = [
  { id: 'vjudge', name: 'Vjudge', color: '#4A90A4' },
  { id: 'luogu', name: '洛谷', color: '#3498db' },
  { id: 'codeforces', name: 'Codeforces', color: '#1f8dd6' },
  { id: 'atcoder', name: 'AtCoder', color: '#333' },
]

interface PlatformBinding {
  id: string
  platform: string
  platformUsername: string | null
  bindingStatus: 'unbound' | 'pending' | 'bound' | 'failed'
  verifiedAt: string | null
}

export default function AdminPlatformBindingsPage() {
  const [bindings, setBindings] = useState<Record<string, PlatformBinding>>({})
  const [loading, setLoading] = useState(true)
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  // 获取绑定状态
  useEffect(() => {
    fetchBindings()
  }, [])

  const fetchBindings = async () => {
    try {
      const result = await apiClient.get<PlatformBinding[]>('/api/platform-bindings')
      if (result.success && result.data) {
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

  const handlePlatformClick = (platformId: string) => {
    setSelectedPlatform(platformId)
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
    if (binding.bindingStatus === 'pending') {
      return { text: '绑定中...', color: 'var(--warning)' }
    }
    return { text: '绑定失败', color: 'var(--error)' }
  }

  const selectedPlatformInfo = PLATFORMS.find((p) => p.id === selectedPlatform)

  return (
    <ProtectedRoute requiredRole={['super_admin', 'platform_admin']}>
      <div style={{ padding: '1rem 0' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          平台绑定
        </h2>
        <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          绑定您的 OJ 平台账号，以便同步题目和成绩数据
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>
            加载中...
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem', maxWidth: '600px' }}>
            {PLATFORMS.map((platform) => {
              const status = getBindingStatus(platform.id)
              return (
                <div
                  key={platform.id}
                  onClick={() => handlePlatformClick(platform.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1rem 1.5rem',
                    background: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--primary)'
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.1)'
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
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 绑定弹窗（框架） */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`绑定 ${selectedPlatformInfo?.name || ''} 账号`}
        width="450px"
      >
        <div style={{ padding: '1.5rem 0', textAlign: 'center', color: 'var(--gray-500)' }}>
          <div style={{ marginBottom: '1rem' }}>
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '12px',
                background: selectedPlatformInfo?.color || '#ccc',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                fontSize: '1.5rem',
                margin: '0 auto 1rem'
              }}
            >
              {selectedPlatformInfo?.name.charAt(0)}
            </div>
            <p style={{ margin: 0 }}>绑定功能开发中...</p>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem' }}>
              敬请期待
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>
            关闭
          </Button>
        </div>
      </Modal>
    </ProtectedRoute>
  )
}