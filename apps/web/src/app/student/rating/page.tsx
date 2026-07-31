'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import RankingsTab from '@/app/teacher/school/components/RankingsTab'
import SolvedCountTab from '@/app/teacher/school/components/SolvedCountTab'
import apiClient from '@/lib/apiClient'

type TabType = 'rating' | 'solved'

export default function StudentRatingPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>('rating')
  const [schoolInfo, setSchoolInfo] = useState<{ educationSystem?: string | null } | null>(null)

  useEffect(() => {
    if (user?.schoolId) {
      apiClient.get<{ educationSystem?: string | null }>(`/api/schools/${user.schoolId}`).then(res => {
        if (res.success && res.data) {
          setSchoolInfo({ educationSystem: res.data.educationSystem })
        }
      })
    }
  }, [user?.schoolId])

  const tabs: { key: TabType; label: string }[] = [
    { key: 'rating', label: 'Rating 排名' },
    { key: 'solved', label: '做题量排名' }
  ]

  return (
    <>
      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>校内排名</h1>

        <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid var(--border)', marginBottom: '1.5rem' }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '0.75rem 1.5rem',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: '0.9375rem',
                fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? 'var(--primary)' : 'var(--text-secondary)',
                borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
                marginBottom: '-2px',
                transition: 'color 0.2s, border-color 0.2s'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {user?.schoolId ? (
          <>
            {activeTab === 'rating' && (
              <RankingsTab schoolId={user.schoolId} educationSystem={schoolInfo?.educationSystem} />
            )}
            {activeTab === 'solved' && (
              <SolvedCountTab schoolId={user.schoolId} educationSystem={schoolInfo?.educationSystem} />
            )}
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
            您还未绑定学校，无法查看排名
          </p>
        )}
      </div>
    </>
  )
}
