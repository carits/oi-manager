'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import {
  useContestDetail,
  ProblemTable,
  ProblemDetail,
  ResourceTable,
  RanklistTable
} from '@/components/ContestDetail'

export default function StudentContestDetailPage() {
  const params = useParams()
  const contestId = Array.isArray(params.id) ? params.id[0] : params.id
  const router = useRouter()

  const [activeTab, setActiveTab] = useState<'problems' | 'ranklist' | 'resources'>('problems')

  const { contest, problems, resources, ranklist, selectedProblem, setSelectedProblem, loading, fetchRanklist } = useContestDetail({ contestId: contestId as string })

  // 切换到排行榜时获取数据
  useEffect(() => {
    if (activeTab === 'ranklist') {
      fetchRanklist()
    }
  }, [activeTab])

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>
        加载中...
      </div>
    )
  }

  if (!contest) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--gray-500)' }}>
        比赛不存在
      </div>
    )
  }

  return (
    <ProtectedRoute requiredRole="student">
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
        {/* 比赛标题 */}
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>{contest.title}</h2>
          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--gray-500)' }}>
            <span>类型: {contest.type === 'training' ? '训练赛' : contest.type === 'official' ? '正赛' : '模拟赛'}</span>
            <span>状态: {contest.status === 'finished' ? '已结束' : contest.status === 'ongoing' ? '进行中' : '即将开始'}</span>
            <span>日期: {new Date(contest.contestDate).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Tab 切换 */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
          <button
            onClick={() => setActiveTab('problems')}
            style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', background: activeTab === 'problems' ? 'var(--primary)' : 'transparent', color: activeTab === 'problems' ? 'white' : 'var(--gray-600)', cursor: 'pointer' }}
          >
            题目列表
          </button>
          <button
            onClick={() => setActiveTab('ranklist')}
            style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', background: activeTab === 'ranklist' ? 'var(--primary)' : 'transparent', color: activeTab === 'ranklist' ? 'white' : 'var(--gray-600)', cursor: 'pointer' }}
          >
            排行榜
          </button>
          <button
            onClick={() => setActiveTab('resources')}
            style={{ padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', background: activeTab === 'resources' ? 'var(--primary)' : 'transparent', color: activeTab === 'resources' ? 'white' : 'var(--gray-600)', cursor: 'pointer' }}
          >
            资料下载
          </button>
        </div>

        {/* 题目列表 */}
        {activeTab === 'problems' && (
          <>
            <ProblemTable
              problems={problems}
              selectedProblem={selectedProblem}
              onSelect={setSelectedProblem}
            />

            {selectedProblem && (
              <ProblemDetail problem={selectedProblem} problems={problems} />
            )}
          </>
        )}

        {/* 排行榜 */}
        {activeTab === 'ranklist' && (
          <RanklistTable ranklist={ranklist} problems={problems} />
        )}

        {/* 资料下载 */}
        {activeTab === 'resources' && (
          <ResourceTable
            resources={resources}
            problems={problems}
          />
        )}
      </div>
    </ProtectedRoute>
  )
}
