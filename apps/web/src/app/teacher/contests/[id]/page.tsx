'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import {
  useContestDetail,
  ProblemTable,
  ProblemDetail,
  ResourceTable,
  RanklistTable
} from '@/components/ContestDetail'

export default function TeacherContestDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { user } = useAuth()
  const contestId = params.id as string

  const [activeTab, setActiveTab] = useState<'problems' | 'ranklist' | 'resources'>('problems')

  const { contest, problems, resources, ranklist, selectedProblem, setSelectedProblem, loading, refetch, fetchRanklist } =
    useContestDetail({ contestId })

  useEffect(() => {
    if (activeTab === 'ranklist') {
      fetchRanklist()
    }
  }, [activeTab])

  // 教师可以管理所有比赛
  const isCreator = true

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>加载中...</div>
    )
  }

  if (!contest) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>比赛不存在</p>
        <Button onClick={() => router.back()}>返回</Button>
      </div>
    )
  }

  const tabs = [
    { key: 'problems', label: '题目' },
    { key: 'ranklist', label: '排行榜' },
    { key: 'resources', label: '资源' }
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
      <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
        <PageHeader title={contest.title}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button variant="secondary" onClick={() => router.back()}>
              返回
            </Button>
            {isCreator && (
              <Button onClick={() => router.push(`/teacher/contests/${contestId}/edit`)}>
                编辑比赛
              </Button>
            )}
          </div>
        </PageHeader>

        {/* 比赛信息 */}
        <div
          style={{
            background: 'white',
            padding: '1rem',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            border: '1px solid var(--border)'
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>比赛类型</div>
              <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                {contest.type === 'training' ? '训练赛' : contest.type === 'official' ? '正赛' : '模拟赛'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>比赛日期</div>
              <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                {new Date(contest.contestDate).toLocaleDateString('zh-CN')}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>状态</div>
              <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                {contest.status === 'upcoming' ? '未开始' : contest.status === 'ongoing' ? '进行中' : '已结束'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}>计入Rating</div>
              <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{contest.countRating ? '是' : '否'}</div>
            </div>
          </div>
          {contest.description && (
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.5rem' }}>比赛说明</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--gray-700)' }}>{contest.description}</div>
            </div>
          )}
        </div>

        {/* Tab 导航 */}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginBottom: '1.5rem',
            background: 'white',
            padding: '0.5rem',
            borderRadius: '8px',
            border: '1px solid var(--border)'
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              style={{
                padding: '0.5rem 1rem',
                border: 'none',
                borderRadius: '6px',
                background: activeTab === tab.key ? 'var(--primary)' : 'transparent',
                color: activeTab === tab.key ? 'white' : 'var(--gray-600)',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: 500
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 内容 */}
        <div style={{ background: 'white', borderRadius: '8px', padding: '1.5rem', border: '1px solid var(--border)' }}>
          {activeTab === 'problems' && (
            <div>
              {selectedProblem ? (
                <div>
                  <Button variant="secondary" onClick={() => setSelectedProblem(null)} style={{ marginBottom: '1rem' }}>
                    ← 返回题目列表
                  </Button>
                  <ProblemDetail problem={selectedProblem} />
                </div>
              ) : (
                <ProblemTable
                  problems={problems}
                  onSelect={setSelectedProblem}
                  showActions={isCreator}
                  onEdit={() => {}}
                  onDelete={() => {}}
                />
              )}
            </div>
          )}

          {activeTab === 'ranklist' && (
            <div>
              <RanklistTable ranklist={ranklist} problems={problems} />
            </div>
          )}

          {activeTab === 'resources' && (
            <div>
              <ResourceTable
                resources={resources}
                problems={problems}
                showActions={isCreator}
                onDelete={() => refetch()}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
