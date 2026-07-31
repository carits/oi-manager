'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'

interface Platform {
  id: string
  name: string
  supported: boolean
  userBindingStatus: 'bound' | 'unbound'
  userBindingUsername: string | null
}

export default function TeamImportPage() {
  const toast = useToast()
  const router = useRouter()
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [selectedPlatform, setSelectedPlatform] = useState<string>('')
  const [createTeam, setCreateTeam] = useState<'yes' | 'no' | ''>('')
  const [teamVisibility, setTeamVisibility] = useState<'public' | 'private'>('public')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPlatforms()
  }, [])

  const fetchPlatforms = async () => {
    try {
      const result = await apiClient.get<{ platforms: Platform[] }>('/api/team-import/platforms')
      if (result.success && result.data) {
        setPlatforms(result.data.platforms)
      }
    } catch (err) {
      console.error('Failed to fetch platforms:', err)
    }
    setLoading(false)
  }

  const handleNext = () => {
    if (!createTeam) {
      toast.warning('请选择是否创建团队')
      return
    }
    if (!selectedPlatform) {
      toast.warning('请选择导入平台')
      return
    }

    // VJudge 使用专用导入页面（从 API 获取团队列表）
    if (selectedPlatform === 'vjudge') {
      const params = new URLSearchParams({ createTeam })
      if (createTeam === 'yes') {
        params.set('visibility', teamVisibility)
      }
      router.push(`/teacher/team-import/vjudge?${params.toString()}`)
      return
    }

    // 洛谷使用专用导入页面
    if (selectedPlatform === 'luogu') {
      const params = new URLSearchParams({ createTeam })
      if (createTeam === 'yes') {
        params.set('visibility', teamVisibility)
      }
      router.push(`/teacher/team-import/luogu?${params.toString()}`)
      return
    }

    // 构建跳转参数
    const params = new URLSearchParams({
      platform: selectedPlatform,
      createTeam: createTeam,
    })
    if (createTeam === 'yes') {
      params.set('visibility', teamVisibility)
    }

    // 检查平台绑定状态
    const platform = platforms.find((p) => p.id === selectedPlatform)
    if (platform?.userBindingStatus === 'unbound') {
      router.push(`/teacher/students/import/bind?${params.toString()}`)
    } else {
      router.push(`/teacher/students/import/input?${params.toString()}`)
    }
  }

  return (
    <>
      <div style={{ padding: '1rem 0' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          导入团队成员
        </h2>
        <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          从外部 OJ 平台批量导入学生
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}>
            <span className="resource-skeleton-line" style={{ display: 'inline-block', width: '8rem' }} aria-label="内容正在准备" />
          </div>
        ) : (
          <div style={{ maxWidth: '600px' }}>
            {/* 第一步：选择是否创建团队 */}
            <div style={{ marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.75rem' }}>
                第一步：是否创建团队
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div
                  onClick={() => setCreateTeam('yes')}
                  style={{
                    padding: '1rem',
                    background: createTeam === 'yes' ? 'var(--primary-light, #eff6ff)' : 'white',
                    border: `2px solid ${createTeam === 'yes' ? 'var(--primary)' : 'var(--border)'}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>创建新团队</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                    自动创建团队并导入成员
                  </div>
                </div>
                <div
                  onClick={() => setCreateTeam('no')}
                  style={{
                    padding: '1rem',
                    background: createTeam === 'no' ? 'var(--primary-light, #eff6ff)' : 'white',
                    border: `2px solid ${createTeam === 'no' ? 'var(--primary)' : 'var(--border)'}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>不创建团队</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                    仅导入成员信息
                  </div>
                </div>
              </div>
            </div>

            {/* 第二步：如果选择创建团队，显示可见性选项 */}
            {createTeam === 'yes' && (
              <div style={{ marginBottom: '2rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.75rem' }}>
                  第二步：选择团队类型
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div
                    onClick={() => setTeamVisibility('public')}
                    style={{
                      padding: '1rem',
                      background: teamVisibility === 'public' ? 'var(--primary-light, #eff6ff)' : 'white',
                      border: `2px solid ${teamVisibility === 'public' ? 'var(--primary)' : 'var(--border)'}`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>公有团队</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                      所有学生可见，可申请加入
                    </div>
                  </div>
                  <div
                    onClick={() => setTeamVisibility('private')}
                    style={{
                      padding: '1rem',
                      background: teamVisibility === 'private' ? 'var(--primary-light, #eff6ff)' : 'white',
                      border: `2px solid ${teamVisibility === 'private' ? 'var(--primary)' : 'var(--border)'}`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>私有团队</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                      仅成员可见，需邀请加入
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 第三步：选择平台 */}
            <div style={{ marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.75rem' }}>
                {createTeam === 'yes' ? '第三步：选择导入平台' : '第二步：选择导入平台'}
              </h3>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {platforms.map((platform) => (
                  <div
                    key={platform.id}
                    onClick={() => setSelectedPlatform(platform.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '1rem',
                      background: selectedPlatform === platform.id ? 'var(--primary-light, #eff6ff)' : 'white',
                      border: `2px solid ${selectedPlatform === platform.id ? 'var(--primary)' : 'var(--border)'}`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500 }}>{platform.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.25rem' }}>
                        {platform.userBindingStatus === 'bound'
                          ? `已绑定: ${platform.userBindingUsername}`
                          : '未绑定，需要先绑定账号'}
                      </div>
                    </div>
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        border: `2px solid ${selectedPlatform === platform.id ? 'var(--primary)' : 'var(--gray-300)'}`,
                        background: selectedPlatform === platform.id ? 'var(--primary)' : 'transparent',
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* 操作按钮 */}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => router.push('/teacher/students')}>
                取消
              </Button>
              <Button onClick={handleNext} disabled={!createTeam || !selectedPlatform}>
                下一步
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}