'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import { Modal } from '@/components/ui/Modal'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { SubmissionDetailModal } from '@/components/submission/SubmissionDetailModal'
import { LANGUAGE_OPTIONS } from '@/lib/judge-constants'
import { OJ_PLATFORM_LABEL_MAP } from '@/lib/oj-platforms'
import { TrainingFormModal } from './TrainingFormModal'
import { useAuth } from '@/components/AuthProvider'
import type { Attachment, TabType } from './types'
import { typeLabel, formatLabel as formatLabelFn } from './types'

import { useTrainingDetail } from './hooks/useTrainingDetail'
import { useTrainingRank } from './hooks/useTrainingRank'
import { useTrainingSubmissions } from './hooks/useTrainingSubmissions'
import { useTrainingActions } from './hooks/useTrainingActions'

import { TrainingProblemList } from './components/TrainingProblemList'
import { TrainingProblemDetail } from './components/TrainingProblemDetail'
import { TrainingRankTable } from './components/TrainingRankTable'
import { TrainingSubmissionPanel } from './components/TrainingSubmissionPanel'
import { TrainingSolutionPanel } from './components/TrainingSolutionPanel'
import { TrainingAttachmentPanel } from './components/TrainingAttachmentPanel'

interface TrainingDetailPageProps {
  basePath: string
  teamIdOverride?: string
}

export function TrainingDetailPage({ basePath, teamIdOverride }: TrainingDetailPageProps) {
  const params = useParams()
  const router = useRouter()
  const { user } = useAuth()
  const trainingId = (params.tid || params.cid) as string
  const teamId = teamIdOverride || (params.id as string)

  const [activeTab, setActiveTab] = useState<TabType>('problemList')
  const [timeDisplay, setTimeDisplay] = useState('')
  const [showMakeupModal, setShowMakeupModal] = useState(false)
  const [makeupTitle, setMakeupTitle] = useState('')
  const [makeupStartTime, setMakeupStartTime] = useState('')
  const [makeupEndTime, setMakeupEndTime] = useState('')
  const [makeupLoading, setMakeupLoading] = useState(false)

  const {
    training, problems, selectedProblemId, setSelectedProblemId,
    problemDetail, loading, error, refresh,
    selectedStatementId, setSelectedStatementId,
    noteContent, setNoteContent, noteSaving,
    noteLastSaved,
    noteEditMode, setNoteEditMode,
    editModeActive, setEditModeActive,
    recordContent, setRecordContent, recordSaving,
    recordLastSaved,
    recordEditMode, setRecordEditMode,
    problemListData, loadProblemListData, clearProblemListData,
    saveNoteNow, saveRecordNow,
  } = useTrainingDetail(trainingId)

  const { rankingData } = useTrainingRank(trainingId, activeTab)

  const sub = useTrainingSubmissions(trainingId, activeTab)

  const actions = useTrainingActions(
    trainingId, training, basePath, teamId,
    selectedProblemId, problems, activeTab,
  )

  // Solutions/attachments state (not extracted to hooks)
  const [allSolutions, setAllSolutions] = useState<Record<string, {
    content: string; visible: boolean; source?: 'training' | 'problem';
    solutionType?: string; solutionPdfUrl?: string
  }>>({})
  const [allAttachments, setAllAttachments] = useState<Record<string, Attachment[]>>({})

  const isUpcoming = training?.status === 'upcoming'
  const hideContent = isUpcoming && !training.isAdmin
  const selectedProblem = problems.find(p => p.id === selectedProblemId)

  // Load problem list when tab changes
  useEffect(() => {
    if (activeTab !== 'problemList') {
      clearProblemListData()
      return
    }
    loadProblemListData()
  }, [activeTab, trainingId, loadProblemListData, clearProblemListData])

  // Load all solutions when tab changes
  useEffect(() => {
    if (activeTab !== 'solutions') {
      setAllSolutions({})
      return
    }
    if (problems.length === 0) return
    const loadAllSolutions = async () => {
      const solutions: Record<string, { content: string; visible: boolean; source?: 'training' | 'problem'; solutionType?: string; solutionPdfUrl?: string }> = {}
      await Promise.all(problems.map(async (p) => {
        try {
          const res = await apiClient.get<{ id: string | null; content: string; visible: boolean; source?: 'training' | 'problem'; solutionType?: string; solutionPdfUrl?: string } | null>(`/api/trainings/${trainingId}/problems/${p.id}/solution`)
          if (res.success && res.data) {
            solutions[p.id] = {
              content: res.data.content || '',
              visible: res.data.visible ?? false,
              source: res.data.source,
              solutionType: res.data.solutionType,
              solutionPdfUrl: res.data.solutionPdfUrl,
            }
          }
        } catch (error) {
          console.error('Failed to load solution for', p.id, error)
        }
      }))
      setAllSolutions(solutions)
    }
    loadAllSolutions()
  }, [activeTab, trainingId, problems])

  // Load all attachments when tab changes
  useEffect(() => {
    if (activeTab !== 'attachments') {
      setAllAttachments({})
      return
    }
    if (problems.length === 0) return
    const loadAllAttachments = async () => {
      const attachments: Record<string, Attachment[]> = {}
      await Promise.all(problems.map(async (p) => {
        try {
          const res = await apiClient.get<Attachment[]>(`/api/trainings/${trainingId}/problems/${p.id}/attachments`)
          if (res.success && res.data) {
            attachments[p.id] = res.data
          }
        } catch (error) {
          console.error('Failed to load attachments for', p.id, error)
        }
      }))
      setAllAttachments(attachments)
    }
    loadAllAttachments()
  }, [activeTab, trainingId, problems])

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

  if (loading) {
    return <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem', textAlign: 'center' }}>加载中...</div>
  }

  if (error || !training) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--gray-50)', padding: '2rem', textAlign: 'center' }}>
        <div style={{ color: 'var(--error)', marginBottom: '1rem' }}>{error || '内容不存在'}</div>
        <button
          onClick={() => router.push(backUrl)}
          style={{ padding: '0.5rem 1rem', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          返回
        </button>
      </div>
    )
  }

  // ========== Derived ==========

  const fmtLabel = formatLabelFn(training.format)
  const tl = typeLabel(training.type)
  const backTab =
    training.type === 'contest' ? 'mock' :
    training.type === 'homework' ? 'homeworks' :
    'training'
  const backUrl = teamId ? `${basePath}/${teamId}?tab=${backTab}` : training.type === 'homework' ? `${basePath}/homeworks` : training.type === 'contest' ? `${basePath}/contests` : `${basePath}?tab=training`
  const statusColors: Record<string, { bg: string; color: string }> = {
    upcoming: { bg: 'var(--info-light)', color: 'var(--info-text)' },
    ongoing: { bg: 'var(--success-light)', color: 'var(--success-text)' },
    finished: { bg: 'var(--bg-muted)', color: 'var(--text-secondary)' },
  }
  const sc = statusColors[training.status] || statusColors.upcoming

  // ========== Render ==========

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: 'white', borderBottom: '1px solid var(--border)', padding: '0.75rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button onClick={() => router.push(backUrl)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>← 返回</button>
            <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />
            <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>{training.title}</h1>
            {training.sourceTrainingId && (
              <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)', background: 'var(--info-light)', color: 'var(--info-text)' }}>补题练习</span>
            )}
            {training.sourceTrainingId && (
              <button
                onClick={() => {
                  const sourcePath = training.type === 'homework'
                    ? (basePath.startsWith('/student') ? `${basePath}/contests/${training.sourceTrainingId}` : `${basePath}/contests/${training.sourceTrainingId}`)
                    : `${basePath}/${teamId}?tab=training`
                  router.push(sourcePath)
                }}
                style={{ fontSize: '0.75rem', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
              >
                查看原活动
              </button>
            )}
            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)', background: 'var(--bg-muted)' }}>{fmtLabel}</span>
            <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: 'var(--radius-sm)', background: sc.bg, color: sc.color }}>
              {training.status === 'upcoming' ? '未开始' : training.status === 'ongoing' ? '进行中' : '已结束'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ fontSize: '0.875rem', fontWeight: 500, fontFamily: 'monospace', color: training.status === 'ongoing' ? 'var(--primary)' : 'var(--gray-500)' }}>
              {timeDisplay}
            </div>
            {training.isAdmin && (
              <>
                {training.status === 'finished' && (
                  <button
                    onClick={() => {
                      setMakeupTitle(`${training.title} - 补题练习`)
                      setMakeupStartTime(new Date().toISOString().slice(0, 16))
                      const defaultEnd = new Date(Date.now() + 7 * 24 * 3600 * 1000)
                      setMakeupEndTime(defaultEnd.toISOString().slice(0, 16))
                      setShowMakeupModal(true)
                    }}
                    style={{ padding: '0.5rem 1rem', border: '1px solid var(--primary)', background: 'white', color: 'var(--primary)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}
                  >
                    创建补题作业
                  </button>
                )}
                <button
                  onClick={() => actions.setShowEditModal(true)}
                  style={{ padding: '0.5rem 1rem', border: '1px solid var(--border)', background: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}
                >
                  编辑
                </button>
                <button
                  onClick={() => actions.setShowDeleteConfirm(true)}
                  style={{ padding: '0.5rem 1rem', border: '1px solid var(--error)', background: 'white', color: 'var(--error)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}
                >
                  删除
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Announcement */}
      {training.description && (
        <div style={{ background: 'var(--warning-light)', borderBottom: '1px solid #fde68a', padding: '0.5rem 1.5rem', fontSize: '0.8rem', color: 'var(--warning-text)' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <strong>公告：</strong>{training.description}
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div style={{ background: 'white', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', gap: 0 }}>
          {(['problemList', 'problems', 'submissions', 'solutions', 'attachments', 'ranking'] as TabType[]).map(tab => {
            const labels: Record<TabType, string> = {
              problemList: '题目列表', problems: '题面', submissions: '评测记录',
              solutions: '题解', attachments: '附件', ranking: '排名',
            }
            const isActive = activeTab === tab
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '0.6rem 1.25rem', border: 'none',
                  borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                  background: 'none', color: isActive ? 'var(--primary)' : 'var(--gray-500)',
                  fontWeight: isActive ? 600 : 400, fontSize: '0.875rem', cursor: 'pointer',
                }}
              >
                {labels[tab]}
              </button>
            )
          })}
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, maxWidth: '1200px', width: '100%', margin: '0 auto', padding: '1rem', boxSizing: 'border-box' }}>
        {hideContent ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔒</div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>{tl}尚未开始</h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              开始时间：{new Date(training.startTime).toLocaleString('zh-CN')}
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              请等待管理员开启{tl}后再查看内容
            </p>
          </div>
        ) : (
        <>
        {activeTab === 'problemList' && (
          <TrainingProblemList
            problemListData={problemListData}
            training={training}
            basePath={basePath}
            onSelectProblem={(id) => setSelectedProblemId(id)}
            onSwitchToProblemsTab={() => setActiveTab('problems')}
          />
        )}

        {activeTab === 'problems' && (
          <TrainingProblemDetail
            problems={problems}
            selectedProblemId={selectedProblemId}
            setSelectedProblemId={setSelectedProblemId}
            problemDetail={problemDetail}
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
            onGoToAttachments={() => setActiveTab('attachments')}
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
          />
        )}

        {activeTab === 'solutions' && (
          <TrainingSolutionPanel
            training={training}
            problems={problems}
            allSolutions={allSolutions}
          />
        )}

        {activeTab === 'attachments' && (
          <TrainingAttachmentPanel
            problems={problems}
            allAttachments={allAttachments}
            onDownload={actions.handleDownloadAttachment}
          />
        )}

        {activeTab === 'ranking' && (
          <TrainingRankTable rankingData={rankingData} currentUserId={user?.userId} />
        )}
        {activeTab === 'ranking' && !rankingData && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-400)' }}>加载中...</div>
        )}
        </>
        )}
      </div>

      {/* Submission Detail Modal */}
      <SubmissionDetailModal
        isOpen={sub.detailSubmissionId !== null}
        onClose={() => sub.setDetailSubmissionId(null)}
        submissionId={sub.detailSubmissionId}
        viewRole={basePath.startsWith('/student') ? 'student' : basePath.startsWith('/platform-admin') ? 'admin' : 'teacher'}
        trainingId={parseInt(trainingId)}
        trainingFormat={training.format}
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
          {/* Submit method selection for non-Carits platforms */}
          {selectedProblem?.platform && selectedProblem.platform !== 'carits' && (
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              {([
                { key: 'robot' as const, label: '机器人账号' },
                { key: 'myAccount' as const, label: '我的账号' },
                { key: 'archive' as const, label: '归档' },
              ]).map(m => (
                <button
                  key={m.key}
                  onClick={() => actions.setSubmitMethod(m.key)}
                  style={{
                    padding: '0.5rem 1rem', fontSize: '0.875rem', border: '1px solid',
                    borderColor: actions.submitMethod === m.key ? 'var(--primary)' : 'var(--border)',
                    borderRadius: '6px',
                    background: actions.submitMethod === m.key ? 'var(--info-light)' : 'white',
                    color: actions.submitMethod === m.key ? 'var(--primary)' : 'var(--gray-500)',
                    cursor: 'pointer',
                    fontWeight: actions.submitMethod === m.key ? 600 : 400,
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {/* Platform account binding hint for myAccount/archive */}
          {selectedProblem?.platform && selectedProblem.platform !== 'carits' && (actions.submitMethod === 'myAccount' || actions.submitMethod === 'archive') && (
            <div style={{
              fontSize: '0.875rem', color: 'var(--gray-500)', padding: '0.5rem 0.75rem',
              background: 'var(--gray-50)', borderRadius: '6px', marginBottom: '1rem',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>平台账号</span>
              <span style={{ color: 'var(--warning)' }}>未绑定</span>
            </div>
          )}

          {/* Language selection - 归档模式下隐藏 */}
          {actions.submitMethod !== 'archive' && (
          <div style={{ marginBottom: '1rem' }}>
            <select
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
          )}

          {/* Code input - 归档模式下隐藏 */}
          {actions.submitMethod !== 'archive' && (
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
          )}

          {/* Submit button */}
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--gray-400)' }}>
              {selectedProblem?.platform === 'carits'
                ? '本地评测'
                : actions.submitMethod === 'robot'
                  ? `${OJ_PLATFORM_LABEL_MAP[selectedProblem?.platform || ''] || ''} 机器人提交已启用`
                  : '暂未开放此提交方式'}
            </span>
            <button
              onClick={handleSubmitCode}
              disabled={actions.submitting || !actions.submitCode.trim() || actions.submitMethod !== 'robot'}
              style={{
                padding: '0.625rem 2rem',
                background: (actions.submitting || !actions.submitCode.trim() || actions.submitMethod !== 'robot') ? 'var(--gray-300)' : 'var(--primary)',
                color: (actions.submitting || !actions.submitCode.trim() || actions.submitMethod !== 'robot') ? 'var(--gray-500)' : 'white',
                border: 'none', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500,
                cursor: (actions.submitting || !actions.submitCode.trim() || actions.submitMethod !== 'robot') ? 'not-allowed' : 'pointer',
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
                    router.push(`${basePath}/homeworks/${(res.data as { id: number }).id}`)
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
