'use client'

import { useCallback, useEffect, useState } from 'react'
import unifiedStyles from './TrainingDetailPage.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import apiClient from '@/lib/apiClient'
import { DetailDialog, FormDialog } from '@/components/ui/Dialogs'
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

import { TrainingRejudgeModal } from './components/TrainingRejudgeModal'
import { TrainingRankingSubmissionsModal } from './components/TrainingRankingSubmissionsModal'
import { TrainingContentSelectionModal } from './components/TrainingContentSelectionModal'
import { TrainingContentSnapshotEditorModal, type EditableActivitySnapshot } from './components/TrainingContentSnapshotEditorModal'
import { TrainingRatingPanel } from '@/features/contest-rating'
import { Bell, BookOpenCheck, Edit3, FilePlus2, LockKeyhole, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/Tabs'
import { SubmissionIoFields, SubmissionCodeEditor, clearSubmissionDraft } from '@/features/submission'
import styles from './TrainingDetail.module.css'
import { useUnsavedChanges } from '@/components/navigation/UnsavedChangesProvider'

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
  () => import('@/features/submission').then(module => module.SubmissionDetailModal),
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
  const platformBasePath = pathname.startsWith('/admin/') ? '/admin' as const : '/platform-admin' as const
  const navigationContext = {
    workspace: pathname.startsWith('/personal/')
      ? 'personal' as const
      : pathname.startsWith('/platform-admin/') || pathname.startsWith('/admin/')
        ? 'platform' as const
        : 'organization' as const,
    organizationId,
    platformBasePath,
    role: user?.organizationRole || 'teacher',
  }

  const validTabs: TabType[] = ['problems', 'submissions', 'solutions', 'attachments', 'ranking']
  const requestedTab = searchParams.get('tab') as TabType | null
  const initialTab = requestedTab === 'problemList' ? 'problems' : requestedTab && validTabs.includes(requestedTab) ? requestedTab : 'problems'
  const [activeTab, setActiveTab] = useState<TabType>(initialTab)
  const [announcementExpanded, setAnnouncementExpanded] = useState(false)
  const [timeDisplay, setTimeDisplay] = useState('')
  const [showMakeupModal, setShowMakeupModal] = useState(false)
  const [makeupTitle, setMakeupTitle] = useState('')
  const [makeupStartTime, setMakeupStartTime] = useState('')
  const [makeupEndTime, setMakeupEndTime] = useState('')
  const [makeupLoading, setMakeupLoading] = useState(false)
  const [showRejudgeModal, setShowRejudgeModal] = useState(false)
  const [showContentSelectionModal, setShowContentSelectionModal] = useState(false)
  const [editingContentSnapshot, setEditingContentSnapshot] = useState<EditableActivitySnapshot | null>(null)
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
    setActiveTab(nextTab === 'problemList' ? 'problems' : nextTab && validTabs.includes(nextTab) ? nextTab : 'problems')
  }, [searchParams])

  const selectTab = (tab: TabType) => {
    setActiveTab(tab)
    const next = new URLSearchParams(searchParams.toString())
    tab === 'problems' ? next.delete('tab') : next.set('tab', tab)
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
    saveNoteNow, saveRecordNow,
  } = useTrainingDetail(trainingId, activeTab, sessionKey)

  const canViewRanking = training ? training.type !== 'homework' || training.isAdmin : !pathname.includes('/homeworks/')
  const rankingTab = canViewRanking ? activeTab : 'problems'
  const { rankingData, rankingState, refreshRanking } = useTrainingRank(trainingId, rankingTab, sessionKey)

  const sub = useTrainingSubmissions(trainingId, activeTab)

  const actions = useTrainingActions(
    trainingId, training, basePath, teamId,
    selectedProblemId, problems, activeTab, problemDetail?.legacyIoSuggestion,
  )

  const solutionsResource = useResource<Record<string, {
    content: string; visible: boolean; source?: 'training' | 'problem';
    solutionType?: string; solutionPdfUrl?: string; fileUrl?: string | null;
    format?: string; snapshotId?: string
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
    { value: 'problems' as const, label: '题目' },
    { value: 'submissions' as const, label: '提交记录' },
    { value: 'solutions' as const, label: '题解' },
    ...(canViewRanking ? [{ value: 'ranking' as const, label: '排名' }] : []),
  ]
  const selectedProblem = problems.find(p => p.id === selectedProblemId)

  useEffect(() => {
    if (training && !canViewRanking && activeTab === 'ranking') {
      const next = new URLSearchParams(searchParams.toString())
      next.delete('tab')
      setActiveTab('problems')
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

  useUnsavedChanges(`training-detail:${trainingId}`, noteSaving || recordSaving)

  // Wire submit code → set detail submission id
  const handleSubmitCode = async () => {
    const submissionId = await actions.handleSubmitCode()
    if (submissionId && selectedProblem) clearSubmissionDraft(`${user?.userId || 'account'}:training:${trainingId}:${selectedProblem.id}`, actions.submitLanguage)
    if (submissionId != null) {
      if (activeTab === 'submissions') {
        sub.setSubmissionsPage(1)
      }
      refresh()
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
    { value: 'problems', label: '题目' },
    { value: 'submissions', label: '提交记录' }, { value: 'solutions', label: '题解' },
    ...(!pathname.includes('/homeworks/') ? [{ value: 'ranking' as TabType, label: '排名' }] : []),
  ]
  const initialListHref = pathname.includes('/homeworks/')
    ? listHref('homework', navigationContext)
    : pathname.includes('/contests/')
      ? listHref('contest', navigationContext)
      : basePath

  if (loading) {
    return (
      <PageFrame width="workbench"><PageHeader title={initialTitle} breadcrumbs={[{ label: typeLabel(pathname.includes('/homeworks/') ? 'homework' : pathname.includes('/contests/') ? 'contest' : 'training'), href: initialListHref }, { label: '详情' }]} /><div className={styles.tabBar}><Tabs label="详情分区" value="problems" onChange={() => undefined} items={initialTabs} /></div><SkeletonRegion rows={8} label="内容正在准备" /></PageFrame>
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
            actions={<div className={styles.actions}><span className={styles.countdown}>{timeDisplay}</span>{training.isAdmin && <Button variant="outline" icon={<BookOpenCheck size={16} />} onClick={() => router.push(`${pathname.replace(/\/$/, '')}/statements`)}>题面选择</Button>}{training.isAdmin && <Button variant="outline" icon={<RotateCcw size={16} />} onClick={() => setShowRejudgeModal(true)}>重测</Button>}{training.isAdmin && training.status === 'finished' && training.organizationId && <Button variant="outline" icon={<FilePlus2 size={16} />} onClick={() => { setMakeupTitle(`${training.title} - 补题练习`); setMakeupStartTime(new Date().toISOString().slice(0, 16)); setMakeupEndTime(new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 16)); setShowMakeupModal(true) }}>创建补题作业</Button>}{training.isAdmin && <Button variant="secondary" icon={<Edit3 size={16} />} onClick={() => actions.setShowEditModal(true)}>编辑</Button>}{training.isAdmin && <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => actions.setShowDeleteConfirm(true)}>删除</Button>}</div>}
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
        {refreshError && (
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
            <h2 className={unifiedStyles.u1}>{tl}尚未开始</h2>
            <p className={unifiedStyles.u2}>
              开始时间：{new Date(training.startTime).toLocaleString('zh-CN')}
            </p>
            <p className={unifiedStyles.u3}>
              请等待管理员开启{tl}后再查看内容
            </p>
            </div>
          </div>
        ) : (
        <>
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
            onManageContentClick={() => setShowContentSelectionModal(true)}
            onEditStatement={statement => selectedProblem && setEditingContentSnapshot({
              kind: 'statement', trainingProblemId: selectedProblem.id, snapshotId: statement.id,
              label: statement.name || selectedProblem.alias || '当前题面', format: statement.format,
              content: statement.content, fileUrl: statement.fileUrl,
            })}
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
                onEditSolution={(problem, solution) => solution.snapshotId && setEditingContentSnapshot({
                  kind: 'solution', trainingProblemId: problem.id, snapshotId: solution.snapshotId,
                  label: problem.alias || problem.problemTitle || '当前题解',
                  format: solution.format || solution.solutionType || 'markdown', content: solution.content,
                  fileUrl: solution.fileUrl || solution.solutionPdfUrl || null,
                })}
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
          <div className={styles.rankingStack}>
            {training.type === 'contest' && (
              <TrainingRatingPanel
                trainingId={trainingId}
                training={training}
                onChanged={async () => { await refresh(); refreshRanking() }}
              />
            )}
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
          </div>
        )}
        </>
        )}
      </div>

      {selectedProblem && (
        <TrainingContentSelectionModal
          isOpen={showContentSelectionModal}
          onClose={() => setShowContentSelectionModal(false)}
          trainingId={trainingId}
          trainingProblemId={selectedProblem.id}
          problemLabel={`${selectedProblem.alias || ''}${selectedProblem.problemTitle ? ` · ${selectedProblem.problemTitle}` : ''}` || '当前题目'}
          onSaved={async () => { await retryProblemDetail(); refresh() }}
        />
      )}

      <TrainingContentSnapshotEditorModal
        isOpen={editingContentSnapshot !== null}
        trainingId={trainingId}
        snapshot={editingContentSnapshot}
        onClose={() => setEditingContentSnapshot(null)}
        onSaved={async (result, kind) => {
          if (kind === 'statement') {
            setSelectedStatementId(result.snapshotId)
            await retryProblemDetail()
          } else await solutionsResource.retry()
        }}
      />

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
        viewRole={basePath.startsWith('/personal') ? 'student' : basePath.startsWith('/platform-admin') || basePath.startsWith('/admin') ? 'admin' : 'teacher'}
        trainingId={parseInt(trainingId)}
        trainingFormat={training.format}
        submissionPathPrefix={pathname.match(/^\/(?:org\/[^/]+|personal|platform-admin|admin)/)?.[0] || (basePath.startsWith('/personal') ? '/personal' : basePath.startsWith('/platform-admin') ? '/platform-admin' : basePath.startsWith('/admin') ? '/admin' : undefined)}
      />

      {/* Submit Code Modal */}
      {actions.showSubmitModal && training.status === 'ongoing' && (
        <DetailDialog
          isOpen={true}
          onClose={() => actions.setShowSubmitModal(false)}
          title={(() => {
            const trainingFinished = (training.status as string) === 'finished' || new Date() > new Date(training.endTime)
            const hideProblemId = !training.problemIdVisible && !trainingFinished && !training.isAdmin
            const platformPrefix = selectedProblem?.platform ? (OJ_PLATFORM_LABEL_MAP[selectedProblem.platform] || selectedProblem.platform) + ' ' : ''
            const problemIdPart = hideProblemId ? '' : (selectedProblem?.platformProblemId || '')
            return `${platformPrefix}${problemIdPart} - ${selectedProblem?.alias || selectedProblem?.problemTitle || ''}`
          })()}
          size="xl"
        >
          <div className={unifiedStyles.u4}>
            代码将使用本场活动发布时固定的测试数据评测，提交结果只计入当前活动。
          </div>

          <div className={unifiedStyles.u5}>
            <Select aria-label="选择"
              value={actions.submitLanguage}
              onChange={e => actions.setSubmitLanguage(e.target.value)}
              className={unifiedStyles.u6}
            >
              {LANGUAGE_OPTIONS.filter(o => o.value).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </div>

          <SubmissionCodeEditor value={actions.submitCode} onChange={actions.setSubmitCode} language={actions.submitLanguage} draftKey={`${user?.userId || 'account'}:training:${trainingId}:${selectedProblem?.id || 'none'}`} minHeight={360} />
          <SubmissionIoFields value={actions.submissionIo} onChange={actions.setSubmissionIo} legacySuggested={Boolean(problemDetail?.legacyIoSuggestion)} />

          {/* Submit button */}
          <div className={unifiedStyles.u7}>
            <span className={unifiedStyles.u8}>
              本地评测 · 题目来源：{OJ_PLATFORM_LABEL_MAP[selectedProblem?.platform || ''] || selectedProblem?.platform || 'Carits'}
            </span>
            <Button variant="primary"
              onClick={handleSubmitCode}
              disabled={actions.submitting || !actions.submitCode.trim() || actions.submissionIo.inputFilename === '' || actions.submissionIo.outputFilename === ''}
            >
              {actions.submitting ? '提交中...' : '提交'}
            </Button>
          </div>
        </DetailDialog>
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
      <FormDialog
        isOpen={showMakeupModal}
        onClose={() => setShowMakeupModal(false)}
        title="创建补题作业"
        size="md"
      >
        <div className={unifiedStyles.u9}>
          <div>
            <label className={unifiedStyles.u10}>标题</label>
            <Input
              value={makeupTitle}
              onChange={e => setMakeupTitle(e.target.value)}
              className={unifiedStyles.u11}
            />
          </div>
          <div>
            <label className={unifiedStyles.u10}>开始时间</label>
            <Input
              type="datetime-local"
              value={makeupStartTime}
              onChange={e => setMakeupStartTime(e.target.value)}
              className={unifiedStyles.u11}
            />
          </div>
          <div>
            <label className={unifiedStyles.u10}>结束时间</label>
            <Input
              type="datetime-local"
              value={makeupEndTime}
              onChange={e => setMakeupEndTime(e.target.value)}
              className={unifiedStyles.u11}
            />
          </div>
          <div className={unifiedStyles.u12}>
            <Button variant="primary"
              onClick={() => setShowMakeupModal(false)}
              className={unifiedStyles.u13}
            >
              取消
            </Button>
            <Button variant="ghost"
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
            >
              {makeupLoading ? '创建中...' : '创建'}
            </Button>
          </div>
        </div>
      </FormDialog>
    </div>
  )
}
