'use client'

import { useCallback, useEffect, useState } from 'react'
import unifiedStyles from './ContestDetailPage.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { DetailDialog, FormDialog } from '@/components/ui/Dialogs'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { AsyncRegion, SkeletonRegion } from '@/components/ui/AsyncRegion'
import { LoadError } from '@/components/ui/LoadError'
import { useResource } from '@/hooks/useResource'
import { LANGUAGE_OPTIONS } from '@/lib/judge-constants'
import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { useAuth } from '@/features/auth'
import type { Attachment, TabType } from '../model/types'
import { typeLabel, formatLabel as formatLabelFn } from '../model/types'
import { listHref, resourceHref } from '@/features/workspace'

import { useContestDetail } from '../api/useContestDetail'
import { useContestRank } from '../api/useContestRank'
import { useContestSubmissions } from '../api/useContestSubmissions'
import { useContestActions } from '../api/useContestActions'
import { createContestMakeupHomework, listContestSubmissionUsers } from '../api/contestApi'

import { ContestRejudgeModal } from './components/ContestRejudgeModal'
import { ContestRankingSubmissionsModal } from './components/ContestRankingSubmissionsModal'
import { ContestContentSelectionModal } from './components/ContestContentSelectionModal'
import { ContestContentEditorModal, type EditableContestContent } from './components/ContestContentEditorModal'
import { TrainingRatingPanel } from '@/features/contest-rating'
import { Bell, BookOpenCheck, Edit3, FilePlus2, LockKeyhole, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Tabs } from '@/components/ui/Tabs'
import { SubmissionIoFields, SubmissionCodeEditor, clearSubmissionDraft } from '@/features/submission'
import styles from './ContestDetail.module.css'
import { useUnsavedChanges } from '@/components/navigation/UnsavedChangesProvider'

const ContestProblemDetail = dynamic(
  () => import('./components/ContestProblemDetail').then(module => module.ContestProblemDetail),
  { loading: () => <SkeletonRegion rows={8} /> },
)
const ContestRankTable = dynamic(
  () => import('./components/ContestRankTable').then(module => module.ContestRankTable),
  { loading: () => <SkeletonRegion rows={6} /> },
)
const ContestSubmissionPanel = dynamic(
  () => import('./components/ContestSubmissionPanel').then(module => module.ContestSubmissionPanel),
  { loading: () => <SkeletonRegion rows={6} /> },
)
const ContestSolutionPanel = dynamic(
  () => import('./components/ContestSolutionPanel').then(module => module.ContestSolutionPanel),
  { loading: () => <SkeletonRegion rows={5} /> },
)
const ContestAttachmentPanel = dynamic(
  () => import('./components/ContestAttachmentPanel').then(module => module.ContestAttachmentPanel),
  { loading: () => <SkeletonRegion rows={4} /> },
)
const SubmissionDetailModal = dynamic(
  () => import('@/features/submission').then(module => module.SubmissionDetailModal),
)
const ContestFormModal = dynamic(
  () => import('./ContestFormModal').then(module => module.ContestFormModal),
)

interface ContestDetailPageProps {
  basePath: string
  teamIdOverride?: string
  contestIdOverride?: string
}

export function ContestDetailPage({ basePath, teamIdOverride, contestIdOverride }: ContestDetailPageProps) {
  const params = useParams()
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, sessionKey } = useAuth()
  const toast = useToast()
  const contestId = contestIdOverride || (params.tid || params.cid || params.id) as string
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
    accountRole: user?.accountRole || 'user',
    organizationRole: user?.organizationRole || undefined,
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
  const [editingContestContent, setEditingContestContent] = useState<EditableContestContent | null>(null)
  const [rejudgeUsers, setRejudgeUsers] = useState<Array<{ id: string; username: string; displayName?: string }>>([])
  const [rejudgeUsersLoading, setRejudgeUsersLoading] = useState(false)
  const [rankingSubmissionContext, setRankingSubmissionContext] = useState<{
    userId: string
    userName?: string
    username?: string
    contestProblemId: string
    problemAlias: string
  } | null>(null)

  const loadRejudgeUsers = useCallback(async () => {
    setRejudgeUsersLoading(true)
    try {
      const data = await listContestSubmissionUsers(contestId)
      setRejudgeUsers(data.users)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重判用户列表加载失败')
    } finally {
      setRejudgeUsersLoading(false)
    }
  }, [toast, contestId])

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
    contest, problems, selectedProblemId, setSelectedProblemId,
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
  } = useContestDetail(contestId, activeTab, sessionKey)

  const canViewRanking = contest ? contest.type !== 'homework' || contest.isAdmin : !pathname.includes('/homeworks/')
  const rankingTab = canViewRanking ? activeTab : 'problems'
  const { rankingData, rankingState, refreshRanking } = useContestRank(contestId, rankingTab, sessionKey)

  const sub = useContestSubmissions(contestId, activeTab)

  const actions = useContestActions(
    contestId, contest, basePath, teamId,
    selectedProblemId, problems, activeTab, problemDetail?.legacyIoSuggestion,
  )

  const solutionsResource = useResource<Record<string, {
    content: string; visible: boolean; source?: 'contest' | 'problem';
    solutionType?: string; solutionPdfUrl?: string; fileUrl?: string | null;
    format?: string; snapshotId?: string
  }>>(
    activeTab === 'solutions' ? `/api/contests/${contestId}/solutions` : null,
    { dedupingInterval: 30000, isEmpty: () => false, sessionKey },
  )
  const attachmentsResource = useResource<Record<string, Attachment[]>>(
    activeTab === 'attachments' ? `/api/contests/${contestId}/attachments` : null,
    { dedupingInterval: 30000, isEmpty: () => false, sessionKey },
  )

  const isUpcoming = contest?.status === 'upcoming'
  const hideContent = isUpcoming && !contest.isAdmin
  const tabItems = [
    { value: 'problems' as const, label: '题目' },
    { value: 'submissions' as const, label: '提交记录' },
    { value: 'solutions' as const, label: '题解' },
    { value: 'attachments' as const, label: '附件' },
    ...(canViewRanking ? [{ value: 'ranking' as const, label: '排名' }] : []),
  ]
  const selectedProblem = problems.find(p => p.id === selectedProblemId)

  useEffect(() => {
    if (contest && !canViewRanking && activeTab === 'ranking') {
      const next = new URLSearchParams(searchParams.toString())
      next.delete('tab')
      setActiveTab('problems')
      router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false })
    }
  }, [activeTab, canViewRanking, pathname, router, searchParams, contest])

  // Countdown timer + status boundary detection
  useEffect(() => {
    if (!contest) return
    const start = new Date(contest.startTime)
    const end = new Date(contest.endTime)
    let refreshed = false

    const update = () => {
      const now = new Date()
      // Detect status boundary: time crossed but frontend state is stale
      if (!refreshed) {
        if (contest.status === 'upcoming' && now >= start) {
          refresh()
          refreshed = true
        } else if (contest.status === 'ongoing' && now > end) {
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
  }, [contest, refresh])

  useUnsavedChanges(`contest-detail:${contestId}`, noteSaving || recordSaving)

  // Wire submit code → set detail submission id
  const handleSubmitCode = async () => {
    const submissionId = await actions.handleSubmitCode()
    if (submissionId && selectedProblem) clearSubmissionDraft(`${user?.userId || 'account'}:contest:${contestId}:${selectedProblem.id}`, actions.submitLanguage)
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
      <PageFrame width="workbench"><PageHeader title={initialTitle} breadcrumbs={[{ label: typeLabel(pathname.includes('/homeworks/') ? 'homework' : pathname.includes('/contests/') ? 'contest' : 'contest'), href: initialListHref }, { label: '详情' }]} /><div className={styles.tabBar}><Tabs label="详情分区" value="problems" onChange={() => undefined} items={initialTabs} /></div><SkeletonRegion rows={8} label="内容正在准备" /></PageFrame>
    )
  }

  if (error || !contest) {
    return (
      <PageFrame><PageHeader title={initialTitle} breadcrumbs={[{ label: '活动', href: initialListHref }, { label: '详情' }]} /><LoadError message={error || '内容不存在'} onRetry={refresh} onBack={() => router.back()} /></PageFrame>
    )
  }

  // ========== Derived ==========

  const fmtLabel = formatLabelFn(contest.format)
  const tl = typeLabel(contest.type)
  const backTab =
    contest.type === 'contest' ? 'mock' :
    contest.type === 'homework' ? 'homeworks' :
    'contest'
  const backUrl = teamId
    ? `${basePath}/${teamId}?tab=${backTab}`
    : contest.type === 'homework'
      ? listHref('homework', navigationContext)
      : contest.type === 'contest'
        ? listHref('contest', navigationContext)
        : `${basePath}?tab=contest`
  const statusColors: Record<string, { bg: string; color: string }> = {
    upcoming: { bg: 'var(--info-light)', color: 'var(--info-text)' },
    ongoing: { bg: 'var(--success-light)', color: 'var(--success-text)' },
    finished: { bg: 'var(--bg-muted)', color: 'var(--text-secondary)' },
  }
  const sc = statusColors[contest.status] || statusColors.upcoming

  // ========== Render ==========

  return (
    <div className={styles.page}>
      <div className={styles.headerArea}>
        <div className={styles.hero}>
          <div className={styles.eyebrow}><span>{tl}工作台</span>{contest.sourceContestId && <StatusBadge variant="info">补题练习</StatusBadge>}<StatusBadge variant={contest.status === 'ongoing' ? 'success' : contest.status === 'upcoming' ? 'info' : 'neutral'}>{contest.status === 'upcoming' ? '未开始' : contest.status === 'ongoing' ? '进行中' : '已结束'}</StatusBadge></div>
          <PageHeader
            title={contest.title}
            breadcrumbs={[{ label: tl, href: backUrl }, { label: contest.title }]}
            actions={<div className={styles.actions}><span className={styles.countdown}>{timeDisplay}</span>{contest.isAdmin && <Button variant="outline" icon={<BookOpenCheck size={16} />} onClick={() => router.push(`${pathname.replace(/\/$/, '')}/statements`)}>题面选择</Button>}{contest.isAdmin && <Button variant="outline" icon={<RotateCcw size={16} />} onClick={() => setShowRejudgeModal(true)}>重测</Button>}{contest.isAdmin && contest.status === 'finished' && contest.organizationId && <Button variant="outline" icon={<FilePlus2 size={16} />} onClick={() => { setMakeupTitle(`${contest.title} - 补题练习`); setMakeupStartTime(new Date().toISOString().slice(0, 16)); setMakeupEndTime(new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 16)); setShowMakeupModal(true) }}>创建补题作业</Button>}{contest.isAdmin && <Button variant="secondary" icon={<Edit3 size={16} />} onClick={() => actions.setShowEditModal(true)}>编辑</Button>}{contest.isAdmin && <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => actions.setShowDeleteConfirm(true)}>删除</Button>}</div>}
          />
          <div className={styles.stats}>
            <div className={styles.stat}><span className={styles.statLabel}>赛制</span><span className={styles.statValue}>{fmtLabel}</span></div>
            <div className={styles.stat}><span className={styles.statLabel}>题目</span><span className={styles.statValue}>{contest.problemCount} 题</span></div>
            <div className={styles.stat}><span className={styles.statLabel}>比赛状态</span><span className={`${styles.statValue} ${contest.status === 'ongoing' ? styles.statValueLive : ''}`}>{contest.status === 'upcoming' ? '等待开始' : contest.status === 'ongoing' ? '正在进行' : '比赛结束'}</span></div>
            <div className={styles.stat}><span className={styles.statLabel}>时间范围</span><span className={styles.statValue}>{new Date(contest.startTime).toLocaleString('zh-CN')} 至 {new Date(contest.endTime).toLocaleString('zh-CN')}</span></div>
          </div>
        </div>
      </div>

      {/* Announcement */}
      {contest.description && (
        <div className={styles.announcement}>
          <div className={styles.announcementContent}><Bell size={18} aria-hidden="true" /><p className={styles.announcementText} data-expanded={announcementExpanded}><strong>公告：</strong>{contest.description}</p></div>
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
              开始时间：{new Date(contest.startTime).toLocaleString('zh-CN')}
            </p>
            <p className={unifiedStyles.u3}>
              请等待管理员开启{tl}后再查看内容
            </p>
            </div>
          </div>
        ) : (
        <>
        {activeTab === 'problems' && (
          <ContestProblemDetail
            problems={problems}
            selectedProblemId={selectedProblemId}
            setSelectedProblemId={setSelectedProblemId}
            problemDetail={problemDetail}
            problemDetailState={problemDetailState}
            retryProblemDetail={retryProblemDetail}
            selectedStatementId={selectedStatementId}
            setSelectedStatementId={setSelectedStatementId}
            contest={contest}
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
            trainingStatus={contest.status as 'upcoming' | 'ongoing' | 'finished'}
            onSubmitClick={() => actions.setShowSubmitModal(true)}
            onManageContentClick={() => setShowContentSelectionModal(true)}
            onEditStatement={statement => selectedProblem && setEditingContestContent({
              kind: 'statement', contestProblemId: selectedProblem.id,
              label: statement.name || selectedProblem.alias || '当前题面', format: statement.format,
              content: statement.content, fileUrl: statement.fileUrl,
            })}
            onGoToAttachments={() => selectTab('attachments')}
            saveNoteNow={saveNoteNow}
            saveRecordNow={saveRecordNow}
          />
        )}

        {activeTab === 'submissions' && (
          <ContestSubmissionPanel
            contest={contest}
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
              <ContestSolutionPanel
                contest={contest}
                problems={problems}
                allSolutions={allSolutions}
                onEditSolution={(problem, solution) => setEditingContestContent({
                  kind: 'solution', contestProblemId: problem.id,
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
              <ContestAttachmentPanel
                problems={problems}
                allAttachments={allAttachments}
                onDownload={actions.handleDownloadAttachment}
              />
            )}
          </AsyncRegion>
        )}

        {activeTab === 'ranking' && canViewRanking && (
          <div className={styles.rankingStack}>
            {contest.type === 'contest' && (
              <TrainingRatingPanel
                trainingId={contestId}
                training={contest}
                onChanged={async () => { await refresh(); refreshRanking() }}
              />
            )}
            <AsyncRegion state={rankingState} onRetry={refreshRanking}>
              {(data) => (
                <ContestRankTable
                  rankingData={data}
                  currentUserId={user?.userId}
                  canViewOtherSubmissions={contest.isAdmin}
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
        <ContestContentSelectionModal
          isOpen={showContentSelectionModal}
          onClose={() => setShowContentSelectionModal(false)}
          contestId={contestId}
          contestProblemId={selectedProblem.id}
          problemLabel={`${selectedProblem.alias || ''}${selectedProblem.problemTitle ? ` · ${selectedProblem.problemTitle}` : ''}` || '当前题目'}
          onSaved={async () => { await retryProblemDetail(); refresh() }}
        />
      )}

      <ContestContentEditorModal
        isOpen={editingContestContent !== null}
        contestId={contestId}
        value={editingContestContent}
        onClose={() => setEditingContestContent(null)}
        onSaved={async kind => {
          if (kind === 'statement') await retryProblemDetail()
          else await solutionsResource.retry()
        }}
      />

      <ContestRejudgeModal
        isOpen={showRejudgeModal}
        onClose={() => setShowRejudgeModal(false)}
        trainingTitle={contest.title}
        contestId={contestId}
        problems={problems}
        users={rejudgeUsers}
        usersLoading={rejudgeUsersLoading}
        onLoadUsers={loadRejudgeUsers}
        onSuccess={async () => { await sub.retry(); refreshRanking(); refresh() }}
      />
      <ContestRankingSubmissionsModal
        isOpen={rankingSubmissionContext !== null}
        onClose={() => setRankingSubmissionContext(null)}
        contestId={contestId}
        contest={contest}
        userId={rankingSubmissionContext?.userId || ''}
        userName={rankingSubmissionContext?.userName}
        username={rankingSubmissionContext?.username}
        contestProblemId={rankingSubmissionContext?.contestProblemId || ''}
        problemAlias={rankingSubmissionContext?.problemAlias || ''}
        onViewSubmission={id => sub.setDetailSubmissionId(id)}
      />
      {/* Submission Detail Modal */}
      <SubmissionDetailModal
        isOpen={sub.detailSubmissionId !== null}
        onClose={() => sub.setDetailSubmissionId(null)}
        submissionId={sub.detailSubmissionId}
        viewRole={basePath.startsWith('/personal') ? 'student' : basePath.startsWith('/platform-admin') || basePath.startsWith('/admin') ? 'admin' : 'teacher'}
        trainingId={parseInt(contestId)}
        trainingFormat={contest.format}
        submissionPathPrefix={pathname.match(/^\/(?:org\/[^/]+|personal|platform-admin|admin)/)?.[0] || (basePath.startsWith('/personal') ? '/personal' : basePath.startsWith('/platform-admin') ? '/platform-admin' : basePath.startsWith('/admin') ? '/admin' : undefined)}
      />

      {/* Submit Code Modal */}
      {actions.showSubmitModal && contest.status === 'ongoing' && (
        <DetailDialog
          isOpen={true}
          onClose={() => actions.setShowSubmitModal(false)}
          title={(() => {
            const trainingFinished = (contest.status as string) === 'finished' || new Date() > new Date(contest.endTime)
            const hideProblemId = !contest.problemIdVisible && !trainingFinished && !contest.isAdmin
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

          <SubmissionCodeEditor value={actions.submitCode} onChange={actions.setSubmitCode} language={actions.submitLanguage} draftKey={`${user?.userId || 'account'}:contest:${contestId}:${selectedProblem?.id || 'none'}`} minHeight={360} />
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

      {/* Edit Contest Modal */}
      <ContestFormModal
        isOpen={actions.showEditModal}
        onClose={() => actions.setShowEditModal(false)}
        teamId={teamId || undefined}
        contestId={contestId}
        mode={contest.type === 'contest' ? 'contest' : contest.type === 'homework' ? 'homework' : 'contest'}
        onSaved={() => {
          actions.setShowEditModal(false)
          refresh()
        }}
      />

      {/* Delete Contest Confirm */}
      <ConfirmModal
        isOpen={actions.showDeleteConfirm}
        onClose={() => actions.setShowDeleteConfirm(false)}
        onConfirm={actions.handleDelete}
        title={`删除${tl}`}
        message={`确定要删除${tl}「${contest.title}」吗？${tl}题目和题解将被删除，但已提交的评测记录会保留。`}
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
                  const res = await createContestMakeupHomework(contestId, {
                    title: makeupTitle,
                    startTime: makeupStartTime ? new Date(makeupStartTime).toISOString() : undefined,
                    endTime: new Date(makeupEndTime).toISOString(),
                  })
                  if (!res.ok) throw res.error
                  setShowMakeupModal(false)
                  const homeworkHref = resourceHref('homework', navigationContext, res.data.id)
                  if (homeworkHref) router.push(homeworkHref)
                } catch (err: unknown) {
                  toast.error((err as Error).message || '创建失败')
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
