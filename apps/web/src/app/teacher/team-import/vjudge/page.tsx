'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import apiClient from '@/lib/apiClient'
import ImportPreview from '@/components/team-import/ImportPreview'
import { useToast } from '@/components/ui/Toast'
import type { ImportMember, ValidateResultItem, ImportResult } from '@/components/team-import/types'

// ── VJudge 平台类型 ──

interface VjudgeGroup {
  groupId: string
  groupName: string
}

interface VjudgePreview {
  groupId: string
  groupName: string
  groupDescription?: string
  announcement?: string
  avatarUrl?: string
  members?: Array<{
    username: string
    nickname: string
    studentName: string
    gender: string
  }>
}

type Step = 'validate' | 'select-vjudge' | 'preview'

// ── 组件 ──

export default function VjudgeImportPage() {
  const router = useRouter()
  const toast = useToast()
  const searchParams = useSearchParams()

  const createTeam = searchParams.get('createTeam') === 'yes'
  const visibility = searchParams.get('visibility') || 'public'

  // 步骤
  const [step, setStep] = useState<Step>('validate')

  // Cookie 验证
  const [validating, setValidating] = useState(false)
  const [cookieValid, setCookieValid] = useState<boolean | null>(null)
  const [cookieError, setCookieError] = useState('')

  // VJudge 团队
  const [groups, setGroups] = useState<VjudgeGroup[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState('')

  // 拉取选项
  const [includeAnnouncement, setIncludeAnnouncement] = useState(true)
  const [includeDescription, setIncludeDescription] = useState(true)
  const [includeMembers, setIncludeMembers] = useState(true)
  const [includeAvatar, setIncludeAvatar] = useState(true)

  // 预览数据（传给 ImportPreview）
  const [previewMembers, setPreviewMembers] = useState<ImportMember[]>([])
  const [previewGroupName, setPreviewGroupName] = useState('')
  const [previewAnnouncement, setPreviewAnnouncement] = useState<string | undefined>()
  const [previewDescription, setPreviewDescription] = useState<string | undefined>()
  const [previewAvatarUrl, setPreviewAvatarUrl] = useState<string | undefined>()
  const [loadingPreview, setLoadingPreview] = useState(false)

  useEffect(() => {
    validateCookie()
  }, [])

  // ── 校验 Cookie ──
  const validateCookie = async () => {
    setValidating(true)
    setCookieError('')
    try {
      // 先快速检查绑定状态
      const statusResult = await apiClient.get<{ bound: boolean; username?: string }>('/api/platform-bindings/vjudge')
      if (!statusResult.success || !statusResult.data?.bound) {
        setCookieValid(false)
        setCookieError('请先绑定 VJudge 账号')
        setValidating(false)
        return
      }

      // 绑定有效，直接拉团队列表
      setCookieValid(true)
      const result = await apiClient.get<VjudgeGroup[]>('/api/team-import/vjudge/groups')
      if (result.success) {
        const groupList = result.data || []
        setGroups(groupList)
        if (groupList.length > 0) {
          setStep('select-vjudge')
        }
      } else {
        // 拉团队失败但不影响绑定状态，可能 Cookie 过期
        const groupList: VjudgeGroup[] = []
        setGroups(groupList)
      }
    } catch (err: any) {
      setCookieValid(false)
      setCookieError(err.message || '网络错误')
    } finally {
      setValidating(false)
    }
  }

  // ── 预览团队 ──
  const handlePreview = async () => {
    if (!selectedGroupId) { toast.warning('请选择VJudge团队'); return }

    setLoadingPreview(true)
    try {
      const result = await apiClient.post<VjudgePreview>('/api/team-import/vjudge/preview', {
        shortName: selectedGroupId,
        includeAnnouncement,
        includeDescription,
        includeMembers,
        includeAvatar
      })

      if (result.success && result.data) {
        setPreviewGroupName(result.data.groupName)
        setPreviewAnnouncement(result.data.announcement)
        setPreviewDescription(result.data.groupDescription)
        setPreviewAvatarUrl(result.data.avatarUrl)
        if (result.data.members) {
          const year = new Date().getFullYear()
          setPreviewMembers(result.data.members.map(m => ({
            username: m.username,
            nickname: m.nickname,
            studentName: m.studentName || m.nickname || m.username,
            gender: m.gender || '男',
            enrollmentYear: year,
            selected: true,
            conflictStatus: 'unchecked' as const,
            conflicts: [],
            action: 'create' as const
          })))
        }
        setStep('preview')
      } else {
        toast.error(result.message || '预览失败')
      }
    } catch {
      toast.error('预览失败')
    } finally {
      setLoadingPreview(false)
    }
  }

  // ── ImportPreview 回调 ──

  const handleValidate = async (members: ImportMember[]): Promise<ValidateResultItem[]> => {
    const result = await apiClient.post<{
      data: ValidateResultItem[]
    }>('/api/team-import/vjudge/validate', {
      members: members.map(m => ({
        username: m.username,
        nickname: m.nickname,
        studentName: m.studentName,
        gender: m.gender
      }))
    })

    if (result.success && result.data) {
      return result.data.data
    }
    throw new Error(result.message || '校验失败')
  }

  const handleImport = async (members: ImportMember[], options?: { createTeam?: boolean; visibility?: string; teamName?: string; teamId?: string; [key: string]: unknown }): Promise<ImportResult> => {
    const result = await apiClient.post<{ data: ImportResult }>('/api/team-import/vjudge/import', {
      createTeam,
      visibility,
      teamName: createTeam ? previewGroupName : undefined,
      teamId: options?.teamId,
      vjudgeGroupId: selectedGroupId,
      announcement: previewAnnouncement || undefined,
      description: previewDescription || undefined,
      avatarUrl: previewAvatarUrl || undefined,
      members: members.map(m => ({
        username: m.username,
        nickname: m.nickname,
        status: m.action === 'invite' ? 'invite' : m.action === 'skip' ? 'skip' : 'new',
        matchedStudentId: m.inviteStudentId,
        matchedStudentName: m.inviteStudentName,
        studentName: m.studentName,
        gender: m.gender,
        enrollmentYear: m.enrollmentYear,
        selected: true
      }))
    })

    if (result.success && result.data) {
      return result.data.data
    }
    throw new Error(result.message || '导入失败')
  }

  const handleComplete = (result: ImportResult) => {
    if (result.teamId) {
      router.push(`/teacher/teams/${result.teamId}`)
    } else {
      router.push('/teacher/teams')
    }
  }

  return (
    <>
      <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
          VJudge 团队导入
        </h1>
        <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
          {createTeam ? '将创建新团队并导入成员' : '仅导入成员信息，不创建团队'}
        </p>

        {/* 步骤指示器 */}
        <div style={{ display: 'flex', marginBottom: '2rem', borderBottom: '1px solid var(--border)' }}>
          {['验证账号', '选择团队', '预览导入'].map((label, index) => {
            const steps: Step[] = ['validate', 'select-vjudge', 'preview']
            const stepIndex = steps.indexOf(step)
            const isActive = index === stepIndex
            const isCompleted = index < stepIndex
            return (
              <div key={label} style={{
                padding: '0.75rem 1rem',
                borderBottom: isActive ? '2px solid var(--primary)' : 'none',
                color: isActive ? 'var(--primary)' : isCompleted ? 'var(--success)' : 'var(--gray-500)',
                fontWeight: isActive ? 'bold' : 'normal'
              }}>
                {index + 1}. {label}
              </div>
            )
          })}
        </div>

        {/* ============ Step 1: 验证 Cookie ============ */}
        {step === 'validate' && (
          <div style={cardStyle}>
            <h2 style={h2Style}>验证 VJudge 账号</h2>
            <p style={{ color: 'var(--gray-500)', marginBottom: '1rem', fontSize: '0.875rem' }}>
              正在检查 VJudge 账号绑定状态...
            </p>
            {cookieValid === false && (
              <div style={errorBoxStyle}>
                <strong>验证失败：</strong>{cookieError}<br />
                <span style={{ fontSize: '0.875rem' }}>
                  请先前往 <a href="/teacher/platform-bindings" style={{ color: 'var(--primary)' }}>平台绑定</a> 页面绑定 VJudge 账号
                </span>
              </div>
            )}
            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={() => router.push('/teacher/students/import')} style={btnSecondary}>返回</button>
              {cookieValid === false && (
                <button onClick={validateCookie} disabled={validating} style={btnPrimary}>
                  {validating ? '验证中...' : '重新验证'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ============ Step 2: 选择团队 ============ */}
        {step === 'select-vjudge' && (
          <div style={cardStyle}>
            <h2 style={h2Style}>选择 VJudge 团队</h2>
            {groups.length === 0 ? (
              <div style={{ color: 'var(--gray-500)' }}>未找到团队</div>
            ) : (
              <>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>选择要导入的团队</label>
                <select aria-label="选择"
                  value={selectedGroupId}
                  onChange={e => setSelectedGroupId(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">请选择团队</option>
                  {groups.map(g => (
                    <option key={g.groupId} value={g.groupId}>
                      {g.groupName} ({g.groupId})
                    </option>
                  ))}
                </select>

                <h3 style={{ fontSize: '1rem', fontWeight: '500', margin: '1rem 0 0.75rem' }}>选择要拉取的内容</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {([
                    [includeAnnouncement, setIncludeAnnouncement, '团队公告'],
                    [includeDescription, setIncludeDescription, '团队描述'],
                    [includeMembers, setIncludeMembers, '团队成员'],
                    [includeAvatar, setIncludeAvatar, '团队头像']
                  ] as [boolean, (v: boolean) => void, string][]).map(([checked, setter, label], i) => (
                    <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={checked} onChange={e => setter(e.target.checked)} />
                      {label}
                    </label>
                  ))}
                </div>
              </>
            )}
            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={() => router.push('/teacher/students/import')} style={btnSecondary}>返回</button>
              <button onClick={handlePreview} disabled={!selectedGroupId || loadingPreview} style={btnPrimary}>
                {loadingPreview ? '正在获取' : '下一步'}
              </button>
            </div>
          </div>
        )}

        {/* ============ Step 3: 预览 & 校验 & 导入（共享组件） ============ */}
        {step === 'preview' && (
          <ImportPreview
            platformName="VJudge"
            platformUsernameLabel="VJudge 用户名"
            initialMembers={previewMembers}
            createTeam={createTeam}
            visibility={visibility}
            teamName={createTeam ? previewGroupName : undefined}
            defaultTeamId={selectedGroupId.replace(/[^a-zA-Z0-9_]/g, '_')}
            onValidate={handleValidate}
            onImport={handleImport}
            onBack={() => setStep('select-vjudge')}
            onComplete={handleComplete}
          />
        )}
      </div>
    </>
  )
}

// ── 样式常量 ──

const cardStyle: React.CSSProperties = {
  background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)'
}

const h2Style: React.CSSProperties = {
  fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '1rem'
}

const errorBoxStyle: React.CSSProperties = {
  padding: '1rem', background: 'var(--error-light)', border: '1px solid #fecaca',
  borderRadius: '6px', marginBottom: '1rem', color: 'var(--error)'
}

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1rem', border: 'none', borderRadius: '6px',
  background: 'var(--primary)', color: 'white', cursor: 'pointer'
}

const btnSecondary: React.CSSProperties = {
  padding: '0.5rem 1rem', border: '1px solid var(--border)', borderRadius: '6px',
  background: 'white', cursor: 'pointer'
}

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem', border: '1px solid var(--border)',
  borderRadius: '6px', fontSize: '1rem', marginBottom: '1rem'
}
