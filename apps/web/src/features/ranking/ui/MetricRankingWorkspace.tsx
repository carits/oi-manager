'use client'

import { useCallback, useEffect, useState } from 'react'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Search, UsersRound } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Pagination } from '@/components/ui/Pagination'
import { Table } from '@/components/ui/Table'
import { useAuth } from '@/features/auth'
import { UserIdentityLink } from '@/features/user-profile'
import { getMetricRanking, type RankingMetric, type RankingScope } from '../api/rankingApi'
import type { RankingRow, RankingTrack } from '@oi-manager/contracts'
import styles from './MetricRankingWorkspace.module.css'

interface MetricRankingWorkspaceProps {
  scope: RankingScope
  metric: RankingMetric
}

function metricLabel(metric: RankingMetric) {
  return metric === 'rating' ? 'Rating' : metric === 'solved' ? '做题量' : '贡献'
}

function metricValue(row: RankingRow, metric: RankingMetric) {
  return metric === 'rating' ? row.rating ?? 0 : metric === 'solved' ? row.solvedCount ?? 0 : row.contributionScore ?? 0
}

function rankClass(index: number) {
  if (index === 0) return styles.rankFirst
  if (index === 1) return styles.rankSecond
  if (index === 2) return styles.rankThird
  return undefined
}

export function MetricRankingWorkspace({ scope, metric }: MetricRankingWorkspaceProps) {
  const { user } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = searchParams.get('q') || ''
  const isContribution = metric === 'contribution'
  const ratingTrack: RankingTrack = metric === 'rating' && ['OI', 'IOI', 'ACM'].includes(searchParams.get('track') || '') ? searchParams.get('track') as RankingTrack : 'OI'
  const grade = scope === 'campus' && !isContribution ? searchParams.get('grade') || '' : ''
  const includeGraduated = scope === 'campus' && !isContribution && searchParams.get('includeGraduated') === '1'
  const page = Math.max(Number(searchParams.get('page')) || 1, 1)
  const pageSize = Math.max(Number(searchParams.get('pageSize')) || 20, 1)
  const [searchValue, setSearchValue] = useState(query)
  const [rows, setRows] = useState<RankingRow[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [grades, setGrades] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const updateQuery = useCallback((updates: Record<string, string | null>, resetPage = true) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    if (resetPage) params.delete('page')
    router.replace(`${pathname}${params.size ? `?${params}` : ''}`, { scroll: false })
  }, [pathname, router, searchParams])

  useEffect(() => setSearchValue(query), [query])

  useEffect(() => {
    if (searchValue === query) return
    const timer = window.setTimeout(() => updateQuery({ q: searchValue.trim() || null }), 260)
    return () => window.clearTimeout(timer)
  }, [query, searchValue, updateQuery])

  const fetchRankings = useCallback(async (signal?: AbortSignal) => {
    const organizationId = pathname.match(/^\/org\/([^/]+)/)?.[1]
    if (scope === 'campus' && !organizationId) return
    setLoading(true)
    setError(null)
    try {
      const result = await getMetricRanking({
        scope, metric, organizationId, track: ratingTrack, signal,
        query: {
          page, pageSize, q: query || undefined,
          grade: scope === 'campus' && !isContribution ? grade || undefined : undefined,
          includeGraduated: scope === 'campus' && !isContribution && includeGraduated ? '1' : undefined,
        },
      })
      setRows(result.items)
      setTotal(result.total)
      setTotalPages(result.totalPages)
      setGrades(result.filters?.grades || [])
    } catch (requestError) {
      if (signal?.aborted) return
      setRows([])
      setError(requestError instanceof Error ? requestError.message : '排名获取失败')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [grade, includeGraduated, metric, page, pageSize, query, pathname, ratingTrack, scope])

  useEffect(() => {
    const controller = new AbortController()
    void fetchRankings(controller.signal)
    return () => controller.abort()
  }, [fetchRankings])

  const startIndex = (page - 1) * pageSize
  const currentUserId = user?.userId
  const valueLabel = metricLabel(metric)

  return (
    <section className={styles.workspace} aria-label={`${scope === 'campus' ? '校内' : '个人'}${valueLabel}排行榜`}>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <label className={styles.searchField}>
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">搜索{scope === 'campus' ? '姓名或用户名' : '用户名'}</span>
            <Input value={searchValue} onChange={event => setSearchValue(event.target.value)} placeholder={scope === 'campus' ? '搜索姓名或用户名' : '搜索用户名'} />
          </label>
          {scope === 'campus' && !isContribution && (
            <label className={styles.selectField}>
              <span className="sr-only">按年级筛选</span>
              <Select value={grade} onChange={event => updateQuery({ grade: event.target.value || null })}>
                <option value="">全部年级</option>
                {grades.map(item => <option key={item} value={item}>{item}</option>)}
              </Select>
            </label>
          )}
          {metric === 'rating' && (
            <label className={styles.selectField}>
              <span className="sr-only">选择 Rating Track</span>
              <Select value={ratingTrack} onChange={event => updateQuery({ track: event.target.value === 'OI' ? null : event.target.value })}>
                <option value="OI">OI Rating</option>
                <option value="IOI">IOI Rating</option>
                <option value="ACM">ACM Rating</option>
              </Select>
            </label>
          )}
          {scope === 'campus' && !isContribution && (
            <label className={styles.checkboxField}>
              <Input type="checkbox" checked={includeGraduated} onChange={event => updateQuery({ includeGraduated: event.target.checked ? '1' : null })} />
              <span>包含已毕业学生</span>
            </label>
          )}
        </div>
        <span className={styles.total} aria-live="polite"><UsersRound size={16} aria-hidden="true" />共 <strong>{total}</strong> 人</span>
      </div>

      <Table
        variant="ranking"
        data={rows}
        loading={loading}
        error={error}
        onRetry={() => void fetchRankings()}
        emptyText={query || grade ? '没有符合筛选条件的排名数据' : isContribution ? '暂无贡献记录' : `暂无${valueLabel}排名数据`}
        caption={`${scope === 'campus' ? '校内' : '个人'}${valueLabel}排行榜`}
        isCurrentRow={row => row.userId === currentUserId || row.id === currentUserId}
        columns={[
          {
            key: 'rank',
            label: '排名',
            width: '80px',
            align: 'center',
            render: (row, index) => {
              const rank = row.rank ?? startIndex + index + 1
              return <span className={`${styles.rank} ${rankClass(rank - 1) || ''}`}>{rank}</span>
            }
          },
          {
            key: 'identity',
            label: scope === 'campus' ? (isContribution ? '成员' : '学生') : '用户名',
            width: '220px',
            render: row => (
              <span className={styles.identity}>
                <UserIdentityLink
                  id={scope === 'campus' ? row.userId || row.id : row.id}
                  userType={scope === 'campus' ? 'student' : 'user'}
                  name={scope === 'campus' ? row.name : undefined}
                  username={row.username}
                  avatar={row.avatar}
                  avatarOnly
                  size={32}
                />
                <UserIdentityLink
                  id={scope === 'campus' ? row.userId || row.id : row.id}
                  userType={scope === 'campus' ? 'student' : 'user'}
                  name={scope === 'campus' ? row.name : undefined}
                  username={row.username}
                  showUsername={scope === 'campus'}
                  currentSuffix={row.userId === currentUserId || row.id === currentUserId ? '（我）' : ''}
                />
              </span>
            )
          },
          {
            key: metric,
            label: metric === 'rating' ? `${ratingTrack} Rating` : valueLabel,
            width: '140px',
            align: 'right',
            render: row => <strong className={metric === 'rating' ? styles.ratingValue : styles.solvedValue}>{metricValue(row, metric)}</strong>
          },
          ...(scope === 'campus' && !isContribution ? [{
            key: 'grade',
            label: '年级',
            width: '140px',
            align: 'left' as const,
            render: (row: RankingRow) => row.grade || '未设置'
          }] : [])
        ]}
      />

      {!loading && !error && total > 0 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          onPageChange={nextPage => updateQuery({ page: String(nextPage) }, false)}
          onPageSizeChange={nextPageSize => updateQuery({ pageSize: String(nextPageSize) })}
          pageSizeOptions={[10, 20, 50, 100]}
          showTotal
          showQuickJumper
        />
      )}
    </section>
  )
}
