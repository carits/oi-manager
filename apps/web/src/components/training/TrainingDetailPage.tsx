'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import apiClient from '@/lib/apiClient'
import { Modal } from '@/components/ui/Modal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { AsyncRegion, SkeletonRegion } from '@/components/ui/AsyncRegion'
import { LoadError } from '@/components/ui/LoadError'
import { useResource } from '@/hooks/useResource'
import { LANGUAGE_OPTIONS } from '@/lib/judge-constants'
import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { useAuth } from '@/components/AuthProvider'
import type { Attachment, TabType } from './types'
import { typeLabel, formatLabel as formatLabelFn } from './types'
import { listHref, resourceHref } from '@/components/workspace/workspaceRouting'

import { useTrainingDetail } from './hooks/useTrainingDetail'
import { useTrainingRank } from './hooks/useTrainingRank'
import { useTrainingSubmissions } from './hooks/useTrainingSubmissions'
import { useTrainingActions } from './hooks/useTrainingActions'

import { TrainingProblemList } from './components/TrainingProblemList'
import { TrainingRejudgeModal } from './components/TrainingRejudgeModal'
import { TrainingRankingSubmissionsModal } from './components/TrainingRankingSubmissionsModal'
import { Bell, Edit3, FilePlus2, LockKeyhole, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/Tabs'
import styles from './TrainingDetail.module.css'

const TrainingProblemDetail = dynamic(
  () => import('./components/TrainingProblemDetail').then(module => module.TrainingProblemDetail),
  { loading: () => <SkeletonRegion rows={8} /> },
)
const TrainingRankTable = dynamic(
  () => import('./components/TrainingRankTable').then(module => module.TrainingRankTable),
  { loading: () => <SkeletonRegion rows={6} /> },
)
const TrainingSubmissionPanel = dynamic(
  () => import('./components/TrainingSubmissionPanel').then(module => module.TrainingSubmissionPanel),
  { loading: () => <SkeletonRegion rows={6} /> },
)
const TrainingSolutionPanel = dynamic(
  () => import('./components/TrainingSolutionPanel').then(module => module.TrainingSolutionPanel),
  { loading: () => <SkeletonRegion rows={5} /> },
)
const TrainingAttachmentPanel = dynamic(
  () => import('./components/TrainingAttachmentPanel').then(module => module.TrainingAttachmentPanel),
  { loading: () => <SkeletonRegion rows={4} /> },
)
const SubmissionDetailModal = dynamic(
  () => import('@/components/submission/SubmissionDetailModal').then(module => module.SubmissionDetailModal),
)
const TrainingFormModal = dynamic(
  () => import('./TrainingFormModal').then(module => module.TrainingFormModal),
)

interface TrainingDetailPageProps {
  basePath: string
  teamIdOverride?: string
  trainingIdOverride?: string
}

export function TrainingDetailPage({ basePath, teamIdOverride, trainingIdOverride }: TrainingDetailPageProps) {
  const params = useParams()
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, sessionKey } = useAuth()
  const trainingId = trainingIdOverride || (params.tid || params.cid || params.id) as string
  const isTeamScopedPath = pathname.includes('/teams/') || pathname.includes('/team/')
  const teamId = teamIdOverride || (isTeamScopedPath ? (params.id as string) : undefined)
  const organizationId = pathname.match(/^\/org\/([^/]+)/)?.[1]
  const navigationContext = {
    workspace: pathname.startsWith('/personal/') ? 'personal' as const : 'organization' as const,
    organizationId,
    role: user?.organizationRole || 'teacher',
  }

  const validTabs: TabType[] = ['problemList', 'problems', 'submissions', 'solutions', 'attachments', 'ranking']
  const requestedTab = searchParams.get('tab') as TabType | null
  const [activeTab, setActiveTab] = useState<TabType>(requestedTab && validTabs.includes(requestedTab) ? requestedTab : 'problemList')
  const [announcementExpanded, setAnnouncementExpanded] = useState(false)
  const [timeDisplay, setTimeDisplay] = useState('')
  const [showMakeupModal, setShowMakeupModal] = useState(false)
  const [makeupTitle, setMakeupTitle] = useState('')
  const [makeupStartTime, setMakeupStartTime] = useState('')
  const [makeupEndTime, setMakeupEndTime] = useState('')
  const [makeupLoading, setMakeupLoading] = useState(false)
  const [showRejudgeModal, setShowRejudgeModal] = useState(false)
  const [rejudgeUsers, setRejudgeUsers] = useState<Array<{ id: string; username: string; displayName?: string }>>([])
  const [rejudgeUsersLoading, setRejudgeUsersLoading] = useState(false)
  const [rankingSubmissionContext, setRankingSubmissionContext] = useState<{
    userId: string
    userName?: string
    username?: string
    trainingProblemId: string
    problemAlias: string
  } | null>(null)

  const loadRejudgeUsers = useCallback(async () => {
    setRejudgeUsersLoading(true)
    try {
      const data = await apiClient.query<{ users: Array<{ id: string; username: string; displayName?: string }> }>('/api/trainings/' + trainingId + '/submission-users')
      setRejudgeUsers(data.users)
    } catch { setRejudgeUsers([]) } finally { setRejudgeUsersLoading(false) }
  }, [trainingId])

  useEffect(() => {
    const nextTab = searchParams.get('tab') as TabType | null
    setActiveTab(nextTab && validTabs.includes(nextTab) ? nextTab : 'problemList')
  }, [searchParams])

  const selectTab = (tab: TabType) => {
    setActiveTab(tab)
    const next = new URLSearchParams(searchParams.toString())
    tab === 'problemList' ? next.delete('tab') : next.set('tab', tab)
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false })
  }

  const {
    training, problems, selectedProblemId, setSelectedProblemId,
    problemDetail, problemDetailState, retryProblemDetail,
    loading, error, refresh, refreshError,
    selectedStatementId, setSelectedStatementId,
    noteContent, setNoteContent, noteSaving,
    noteLastSaved,
    noteEditMode, setNoteEditMode,
    editModeActive, setEditModeActive,
    recordContent, setRecordContent, recordSaving,
    recordLastSaved,
    recordEditMode, setRecordEditMode,
    problemListState, loadProblemListData,
    saveNoteNow, saveRecordNow,
  } = useTrainingDetail(trainingId, activeTab, sessionKey)

  const canViewRanking = training ? training.type !== 'homework' || training.isAdmin : !pathname.includes('/homeworks/')
  const rankingTab = canViewRanking ? activeTab : 'problemList'
  const { rankingData, rankingState, refreshRanking } = useTrainingRank(trainingId, rankingTab, sessionKey)

  const sub = useTrainingSubmissions(trainingId, activeTab)

  const actions = useTrainingActions(
    trainingId, training, basePath, teamId,
    selectedProblemId, problems, activeTab,
  )

  const solutionsResource = useResource<Record<string, {
    content: string; visible: boolean; source?: 'training' | 'problem';
    solutionType?: string; solutionPdfUrl?: string
  }>>(
    activeTab === 'solutions' ? `/api/trainings/${trainingId}/solutions` : null,
    { dedupingInterval: 30000, isEmpty: () => false, sessionKey },
  )
  const attachmentsResource = useResource<Record<string, Attachment[]>>(
    activeTab === 'attachments' ? `/api/trainings/${trainingId}/attachments` : null,
    { dedupingInterval: 30000, isEmpty: () => false, sessionKey },
  )

  const isUpcoming = training?.status === 'upcoming'
  const hideContent = isUpcoming && !training.isAdmin
  const tabItems = [
    { value: 'problemList' as const, label: '题目列表' },
    { value: 'problems' as const, label: '题面' },
    { value: 'submissions' as const, label: '评测记录' },
    { value: 'solutions' as const, label: '题解' },
    { value: 'attachments' as const, label: '附件' },
    ...(canViewRanking ? [{ value: 'ranking' as const, label: '排名' }] : []),
  ]
  const selectedProblem = problems.find(p => p.id === selectedProblemId)

  useEffect(() => {
    if (training && !canViewRanking && activeTab === 'ranking') {
      const next = new URLSearchParams(searchParams.toString())
      next.delete('tab')
      setActiveTab('problemList')
      router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false })
    }
  }, [activeTab, canViewRanking, pathname, router, searchParams, training])

  // Countdown timer + status boundary detection
  useEffect(() => {
    if (!training) return
    const start = new Date(training.startTime)
    const end = new Date(training.endTime)
    let refreshed = false

    const update = () => {
      const now = new Date()
      // Detect status boundary: time crossed but frontend state is stale
      if (!refreshed) {
        if (training.status === 'upcoming' && now >= start) {
          refresh()
          refreshed = true
        } else if (training.status === 'ongoing' && now > end) {
          refresh()
          refreshed = true
        }
      }
      if (now < start) {
        const diff = start.getTime() - now.getTime()
        const h = Math.floor(diff / 3600000)
        const m = Math.floor((diff % 3600000) / 60000)
        const s = Math.floor((diff % 60000) / 1000)
        setTimeDisplay(`距离开始: ${h}h ${m}m ${s}s`)
      } else if (now <= end) {
        const diff = end.getTime() - now.getTime()
        const h = Math.floor(diff / 3600000)
        const m = Math.floor((diff % 3600000) / 60000)
        const s = Math.floor((diff % 60000) / 1000)
        setTimeDisplay(`剩余: ${h}h ${m}m ${s}s`)
      } else {
        setTimeDisplay('已结束')
      }
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [training, refresh])

  // beforeunload protection (prevent accidental data loss when saving is in progress)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (noteSaving || recordSaving) {
        e.preventDefault()
        // Legacy browsers require returnValue to be set
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [noteSaving, recordSaving])

  // Wire submit code → set detail submission id
  const handleSubmitCode = async () => {
    const submissionId = await actions.handleSubmitCode()
    if (submissionId != null) {
      if (activeTab === 'submissions') {
        sub.setSubmissionsPage(1)
      }
      if (activeTab === 'problemList') {
        loadProblemListData()
      }
      sub.setDetailSubmissionId(submissionId)
    }
  }

  // ========== Loading / Error ==========

  const initialTitle = pathname.includes('/homeworks/')
    ? '作业详情'
    : pathname.includes('/contests/')
      ? '比赛详情'
      : '训练详情'
  const initialTabs: Array<{ value: TabType; label: string }> = [
    { value: 'problemList', label: '题目列表' }, { value: 'problems', label: '题面' },
    { value: 'submissions', label: '评测记录' }, { value: 'solutions', label: '题解' },
    { value: 'attachments', label: '附件' },
    ...(!pathname.includes('/homeworks/') ? [{ value: 'ranking' as TabType, label: '排名' }] : []),
  ]
  const initialListHref = pathname.includes('/homeworks/')
    ? listHref('homework', navigationContext)
    : pathname.includes('/contests/')
      ? listHref('contest', navigationContext)
      : basePath

  if (loading) {
    return (
      <PageFrame width="workbench"><PageHeader title={initialTitle} breadcrumbs={[{ label: typeLabel(pathname.includes('/homeworks/') ? 'homework' : pathname.includes('/contests/') ? 'contest' : 'training'), href: initialListHref }, { label: '详情' }]} /><div className={styles.tabBar}><Tabs label="详情分区" value="problemList" onChange={() => undefined} items={initialTabs} /></div><SkeletonRegion rows={8} label="训练内容正在准备" /></PageFrame>
    )
  }

  if (error || !training) {
    return (
      <PageFrame><PageHeader title={initialTitle} breadcrumbs={[{ label: '活动', href: initialListHref }, { label: '详情' }]} /><LoadError message={error || '内容不存在'} onRetry={refresh} onBack={() => router.back()} /></PageFrame>
    )
  }

  // ========== Derived ==========

  const fmtLabel = formatLabelFn(training.format)
  const tl = typeLabel(training.type)
  const backTab =
    training.type === 'contest' ? 'mock' :
    training.type === 'homework' ? 'homeworks' :
    'training'
  const backUrl = teamId
    ? `${basePath}/${teamId}?tab=${backTab}`
    : training.type === 'homework'
      ? listHref('homework', navigationContext)
      : training.type === 'contest'
        ? listHref('contest', navigationContext)
        : `${basePath}?tab=training`
  const statusColors: Record<string, { bg: string; color: string }> = {
    upcoming: { bg: 'var(--info-light)', color: 'var(--info-text)' },
    ongoing: { bg: 'var(--success-light)', color: 'var(--success-text)' },
    finished: { bg: 'var(--bg-muted)', color: 'var(--text-secondary)' },
  }
  const sc = statusColors[training.status] || statusColors.upcoming

  // ========== Render ==========

  return (
    <div className={styles.page}>
      <div className={styles.headerArea}>
        <div className={styles.hero}>
          <div className={styles.eyebrow}><span>{tl}工作台</span>{training.sourceTrainingId && <StatusBadge variant="info">补题练习</StatusBadge>}<StatusBadge variant={training.status === 'ongoing' ? 'success' : training.status === 'upcoming' ? 'info' : 'neutral'}>{training.status === 'upcoming' ? '未开始' : training.status === 'ongoing' ? '进行中' : '已结束'}</StatusBadge></div>
          <PageHeader
            title={training.title}
            breadcrumbs={[{ label: tl, href: backUrl }, { label: training.title }]}
            actions={<div className={styles.actions}><span className={styles.countdown}>{timeDisplay}</span>{training.isAdmin && <Button variant="outline" icon={<RotateCcw size={16} />} onClick={() => setShowRejudgeModal(true)}>重测</Button>}{training.isAdmin && training.status === 'finished' && <Button variant="outline" icon={<FilePlus2 size={16} />} onClick={() => { setMakeupTitle(`${training.title} - 补题练习`); setMakeupStartTime(new Date().toISOString().slice(0, 16)); setMakeupEndTime(new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 16)); setShowMakeupModal(true) }}>创建补题作业</Button>}{training.isAdmin && <Button variant="secondary" icon={<Edit3 size={16} />} onClick={() => actions.setShowEditModal(true)}>编辑</Button>}{training.isAdmin && <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => actions.setShowDeleteConfirm(true)}>删除</Button>}</div>}
          />
          <div className={styles.stats}>
            <div className={styles.stat}><span className={styles.statLabel}>赛制</span><span className={styles.statValue}>{fmtLabel}</span></div>
            <div className={styles.stat}><span className={styles.statLabel}>题目</span><span className={styles.statValue}>{training.problemCount} 题</span></div>
            <div className={styles.stat}><span className={styles.statLabel}>比赛状态</span><span className={`${styles.statValue} ${training.status === 'ongoing' ? styles.statValueLive : ''}`}>{training.status === 'upcoming' ? '等待开始' : training.status === 'ongoing' ? '正在进行' : '比赛结束'}</span></div>
            <div className={styles.stat}><span className={styles.statLabel}>时间范围</span><span className={styles.statValue}>{new Date(training.startTime).toLocaleString('zh-CN')} 至 {new Date(training.endTime).toLocaleString('zh-CN')}</span></div>
          </div>
        </div>
      </div>

      {/* Announcement */}
      {training.description && (
        <div className={styles.announcement}>
          <div className={styles.announcementContent}><Bell size={18} aria-hidden="true" /><p className={styles.announcementText} data-expanded={announcementExpanded}><strong>公告：</strong>{training.description}</p></div>
          <Button variant="text" size="sm" onClick={() => setAnnouncementExpanded(value => !value)}>{announcementExpanded ? '收起' : '展开'}</Button>
        </div>
      )}

      {/* Tab Bar */}
      <div className={styles.tabBar}><Tabs label={`${tl}内容`} value={activeTab} onChange={selectTab} items={tabItems} /></div>

      {/* Main Content */}
      <div className={styles.content}>
        {refreshError && activeTab !== 'problemList' && (
          <LoadError
            compact
            message={refreshError.message}
            requestId={refreshError.requestId}
            onRetry={refresh}
          />
        )}
        {hideContent ? (
          <div className={styles.locked}>
            <div className={styles.lockedInner}><LockKeyhole size={36} aria-hidden="true" />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>{tl}尚未开始</h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              开始时间：{new Date(training.startTime).toLocaleString('zh-CN')}
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              请等待管理员开启{tl}后再查看内容
            </p>
            </div>
          </div>
        ) : (
        <>
        {activeTab === 'problemList' && (
          <AsyncRegion
            state={problemListState}
            onRetry={loadProblemListData}
            emptyText="暂无题目"
            skeletonRows={6}
          >
            {(data) => (
              <TrainingProblemList
                problemListData={data}
                training={training}
                basePath={basePath}
                onSelectProblem={(id) => setSelectedProblemId(id)}
                onSwitchToProblemsTab={() => selectTab('problems')}
              />
            )}
          </AsyncRegion>
        )}

        {activeTab === 'problems' && (
          <TrainingProblemDetail
            problems={problems}
            selectedProblemId={selectedProblemId}
            setSelectedProblemId={setSelectedProblemId}
            problemDetail={problemDetail}
            problemDetailState={problemDetailState}
            retryProblemDetail={retryProblemDetail}
            selectedStatementId={selectedStatementId}
            setSelectedStatementId={setSelectedStatementId}
            training={training}
            noteContent={noteContent}
            setNoteContent={setNoteContent}
            noteSaving={noteSaving}
            noteLastSaved={noteLastSaved}
            noteEditMode={noteEditMode}
            setNoteEditMode={setNoteEditMode}
            editModeActive={editModeActive}
            setEditModeActive={setEditModeActive}
            recordContent={recordContent}
            setRecordContent={setRecordContent}
            recordSaving={recordSaving}
            recordLastSaved={recordLastSaved}
            recordEditMode={recordEditMode}
            setRecordEditMode={setRecordEditMode}
            trainingStatus={training.status as 'upcoming' | 'ongoing' | 'finished'}
            onSubmitClick={() => actions.setShowSubmitModal(true)}
            onGoToAttachments={() => selectTab('attachments')}
            saveNoteNow={saveNoteNow}
            saveRecordNow={saveRecordNow}
          />
        )}

        {activeTab === 'submissions' && (
          <TrainingSubmissionPanel
            training={training}
            problems={problems}
            submissions={sub.submissions}
            submissionsPage={sub.submissionsPage}
            submissionsTotal={sub.submissionsTotal}
            filterProblemId={sub.filterProblemId}
            setFilterProblemId={sub.setFilterProblemId}
            filterUsername={sub.filterUsername}
            setFilterUsername={sub.setFilterUsername}
            filterResult={sub.filterResult}
            setFilterResult={sub.setFilterResult}
            filterLanguage={sub.filterLanguage}
            setFilterLanguage={sub.setFilterLanguage}
            setSubmissionsPage={sub.setSubmissionsPage}
            resetFilters={sub.resetFilters}
            onViewSubmission={(id) => sub.setDetailSubmissionId(id)}
            onLanguageClick={(id) => sub.setDetailSubmissionId(id)}
            loading={sub.loading}
            error={sub.error}
            onRetry={() => { void sub.retry() }}
          />
        )}

        {activeTab === 'solutions' && (
          <AsyncRegion state={solutionsResource.state} onRetry={solutionsResource.retry}>
            {(allSolutions) => (
              <TrainingSolutionPanel
                training={training}
                problems={problems}
                allSolutions={allSolutions}
              />
            )}
          </AsyncRegion>
        )}

        {activeTab === 'attachments' && (
          <AsyncRegion state={attachmentsResource.state} onRetry={attachmentsResource.retry}>
            {(allAttachments) => (
              <TrainingAttachmentPanel
                problems={problems}
                allAttachments={allAttachments}
                onDownload={actions.handleDownloadAttachment}
              />
            )}
          </AsyncRegion>
        )}

        {activeTab === 'ranking' && canViewRanking && (
          <AsyncRegion state={rankingState} onRetry={refreshRanking}>
            {(data) => (
              <TrainingRankTable
                rankingData={data}
                currentUserId={user?.userId}
                canViewOtherSubmissions={training.isAdmin}
                onOpenSubmissions={setRankingSubmissionContext}
              />
            )}
          </AsyncRegion>
        )}
        </>
        )}
      </div>

      <TrainingRejudgeModal
        isOpen={showRejudgeModal}
        onClose={() => setShowRejudgeModal(false)}
        trainingTitle={training.title}
        trainingId={trainingId}
        problems={problems}
        users={rejudgeUsers}
        usersLoading={rejudgeUsersLoading}
        onLoadUsers={loadRejudgeUsers}
        onSuccess={async () => { await sub.retry(); refreshRanking(); refresh() }}
      />
      <TrainingRankingSubmissionsModal
        isOpen={rankingSubmissionContext !== null}
        onClose={() => setRankingSubmissionContext(null)}
        trainingId={trainingId}
        training={training}
        userId={rankingSubmissionContext?.userId || ''}
        userName={rankingSubmissionContext?.userName}
        username={rankingSubmissionContext?.username}
        trainingProblemId={rankingSubmissionContext?.trainingProblemId || ''}
        problemAlias={rankingSubmissionContext?.problemAlias || ''}
        onViewSubmission={id => sub.setDetailSubmissionId(id)}
      />
      {/* Submission Detail Modal */}
      <SubmissionDetailModal
        isOpen={sub.detailSubmissionId !== null}
        onClose={() => sub.setDetailSubmissionId(null)}
        submissionId={sub.detailSubmissionId}
        viewRole={basePath.startsWith('/personal') ? 'student' : basePath.startsWith('/platform-admin') ? 'admin' : 'teacher'}
        trainingId={parseInt(trainingId)}
        trainingFormat={training.format}
        submissionPathPrefix={pathname.match(/^\/(?:org\/[^/]+|personal|platform-admin)/)?.[0] || (basePath.startsWith('/personal') ? '/personal' : basePath.startsWith('/platform-admin') ? '/platform-admin' : undefined)}
      />

      {/* Submit Code Modal */}
      {actions.showSubmitModal && training.status === 'ongoing' && (
        <Modal
          isOpen={true}
          onClose={() => actions.setShowSubmitModal(false)}
          title={(() => {
            const trainingFinished = (training.status as string) === 'finished' || new Date() > new Date(training.endTime)
            const hideProblemId = !training.problemIdVisible && !trainingFinished && !training.isAdmin
            const platformPrefix = selectedProblem?.platform ? (OJ_PLATFORM_LABEL_MAP[selectedProblem.platform] || selectedProblem.platform) + ' ' : ''
            const problemIdPart = hideProblemId ? '' : (selectedProblem?.platformProblemId || '')
            return `${platformPrefix}${problemIdPart} - ${selectedProblem?.alias || selectedProblem?.problemTitle || ''}`
          })()}
          width="750px"
        >
          <div style={{
            fontSize: '0.875rem', color: 'var(--gray-500)', padding: '0.65rem 0.8rem',
            background: 'var(--gray-50)', borderRadius: '6px', marginBottom: '1rem',
          }}>
            代码将使用本站测试数据进行本地评测。远程提交记录可在题目页同步归档，且不计入本场比赛。
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <select aria-label="选择"
              value={actions.submitLanguage}
              onChange={e => actions.setSubmitLanguage(e.target.value)}
              style={{
                padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px',
                fontSize: '0.875rem', minWidth: '150px', background: 'white',
              }}
            >
              {LANGUAGE_OPTIONS.filter(o => o.value).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <textarea
            placeholder="在此输入代码..."
            value={actions.submitCode}
            onChange={e => actions.setSubmitCode(e.target.value)}
            style={{
              width: '100%', minHeight: '350px', padding: '1rem', border: '1px solid var(--border)',
              borderRadius: '8px', fontSize: '0.875rem',
              fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
              lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box',
              background: 'white',
              color: 'var(--text-primary)',
            }}
          />

          {/* Submit button */}
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--gray-400)' }}>
              本地评测 · 题目来源：{OJ_PLATFORM_LABEL_MAP[selectedProblem?.platform || ''] || selectedProblem?.platform || 'Carits'}
            </span>
            <button
              onClick={handleSubmitCode}
              disabled={actions.submitting || !actions.submitCode.trim()}
              style={{
                padding: '0.625rem 2rem',
                background: (actions.submitting || !actions.submitCode.trim()) ? 'var(--gray-300)' : 'var(--primary)',
                color: (actions.submitting || !actions.submitCode.trim()) ? 'var(--gray-500)' : 'white',
                border: 'none', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500,
                cursor: (actions.submitting || !actions.submitCode.trim()) ? 'not-allowed' : 'pointer',
                opacity: actions.submitting ? 0.7 : 1,
              }}
            >
              {actions.submitting ? '提交中...' : '提交'}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Training Modal */}
      <TrainingFormModal
        isOpen={actions.showEditModal}
        onClose={() => actions.setShowEditModal(false)}
        teamId={teamId || undefined}
        trainingId={trainingId}
        mode={training.type === 'contest' ? 'contest' : training.type === 'homework' ? 'homework' : 'training'}
        onSaved={() => {
          actions.setShowEditModal(false)
          refresh()
        }}
      />

      {/* Delete Training Confirm */}
      <ConfirmModal
        isOpen={actions.showDeleteConfirm}
        onClose={() => actions.setShowDeleteConfirm(false)}
        onConfirm={actions.handleDelete}
        title={`删除${tl}`}
        message={`确定要删除${tl}「${training.title}」吗？${tl}题目和题解将被删除，但已提交的评测记录会保留。`}
        confirmText="确认删除"
        danger
        loading={actions.deleting}
      />

      {/* Makeup Homework Modal */}
      <Modal
        isOpen={showMakeupModal}
        onClose={() => setShowMakeupModal(false)}
        title="创建补题作业"
        width="500px"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>标题</label>
            <input
              value={makeupTitle}
              onChange={e => setMakeupTitle(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>开始时间</label>
            <input
              type="datetime-local"
              value={makeupStartTime}
              onChange={e => setMakeupStartTime(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>结束时间</label>
            <input
              type="datetime-local"
              value={makeupEndTime}
              onChange={e => setMakeupEndTime(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.875rem', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button
              onClick={() => setShowMakeupModal(false)}
              style={{ padding: '0.5rem 1rem', border: '1px solid var(--border)', background: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}
            >
              取消
            </button>
            <button
              onClick={async () => {
                setMakeupLoading(true)
                try {
                  const res = await apiClient.post(`/api/trainings/${trainingId}/create-makeup-homework`, {
                    title: makeupTitle,
                    startTime: makeupStartTime ? new Date(makeupStartTime).toISOString() : undefined,
                    endTime: new Date(makeupEndTime).toISOString(),
                  })
                  if (res.success && (res.data as { id?: number })?.id) {
                    setShowMakeupModal(false)
                    const homeworkHref = resourceHref('homework', navigationContext, (res.data as { id: number }).id)
                    if (homeworkHref) router.push(homeworkHref)
                  } else {
                    alert(res.message || '创建失败')
                  }
                } catch (err: unknown) {
                  alert((err as Error).message || '创建失败')
                } finally {
                  setMakeupLoading(false)
                }
              }}
              disabled={makeupLoading || !makeupEndTime}
              style={{
                padding: '0.5rem 1rem',
                background: (makeupLoading || !makeupEndTime) ? 'var(--gray-300)' : 'var(--primary)',
                color: (makeupLoading || !makeupEndTime) ? 'var(--gray-500)' : 'white',
                border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500,
              }}
            >
              {makeupLoading ? '创建中...' : '创建'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
