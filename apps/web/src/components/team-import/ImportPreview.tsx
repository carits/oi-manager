'use client'

import { useState, useEffect, useRef } from 'react'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import unifiedStyles from './ImportPreview.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import {
  type ImportMember,
  type ConflictInfo,
  type ValidateResultItem,
  type ImportResult,
  type ImportResultDetail,
  CONFLICT_LABELS,
  isValidUsername
} from './types'
import apiClient from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'

const conflictColorStyle = (color: string): React.CSSProperties => ({ '--conflict-color': color } as React.CSSProperties)

// ── 可编辑文本框：独立 state，打字时不触发父组件重渲染 ──

function EditableField({
  value,
  onChange,
  style,
  error,
}: {
  value: string
  onChange: (v: string) => void
  style?: React.CSSProperties
  error?: boolean
}) {
  const [local, setLocal] = useState(value)
  const focused = useRef(false)

  // 外部 value 变化且未聚焦时同步
  useEffect(() => {
    if (!focused.current) setLocal(value)
  }, [value])

  return (
    <Input
      type="text"
      value={local}
      onChange={e => setLocal(e.target.value)}
      onFocus={() => { focused.current = true }}
      onBlur={() => {
        focused.current = false
        if (local !== value) onChange(local)
      }}
      style={style}
      className={error ? unifiedStyles.editableError : undefined}
    />
  )
}

// ── Props ──

interface ImportPreviewProps {
  /** 平台名（如 'VJudge'、'洛谷'），用于显示 */
  platformName: string
  /** 平台标识，用于结果表中"平台用户名"列标题 */
  platformUsernameLabel?: string
  /** 初始成员列表 */
  initialMembers: ImportMember[]
  /** 是否创建新团队 */
  createTeam: boolean
  /** 团队可见性 */
  visibility: string
  /** 新团队名称（createTeam 时用） */
  teamName?: string
  /** 默认团队ID（VJudge=shortName, 洛谷=teamId） */
  defaultTeamId?: string
  /** 校验 API 调用 */
  onValidate: (members: ImportMember[]) => Promise<ValidateResultItem[]>
  /** 导入 API 调用 */
  onImport: (members: ImportMember[], options: ImportOptions) => Promise<ImportResult>
  /** 返回上一步 */
  onBack: () => void
  /** 导入完成后跳转 */
  onComplete: (result: ImportResult) => void
}

export interface ImportOptions {
  createTeam: boolean
  visibility: string
  teamName?: string
  teamId?: string
  [key: string]: unknown
}

// ── 主组件 ──

export default function ImportPreview({
  platformName,
  platformUsernameLabel = '平台用户名',
  initialMembers,
  createTeam,
  visibility,
  teamName,
  defaultTeamId,
  onValidate,
  onImport,
  onBack,
  onComplete
}: ImportPreviewProps) {
  const toast = useToast()
  const [members, setMembers] = useState<ImportMember[]>(initialMembers)
  const [batchEnrollmentYear] = useState(new Date().getFullYear())
  const [showCleared, setShowCleared] = useState(false)

  // 团队标识
  const [teamId, setTeamId] = useState(defaultTeamId || '')
  const [teamIdError, setTeamIdError] = useState('')
  const [teamIdValidating, setTeamIdValidating] = useState(false)

  // 校验
  const [validatingMembers, setValidatingMembers] = useState(false)
  const [validated, setValidated] = useState(false)

  // 导入
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)

  // ── 统计 ──
  const selectedMembers = members.filter(m => m.selected)
  const conflictMembers = selectedMembers.filter(m => m.conflictStatus === 'conflict')
  const clearedMembers = selectedMembers.filter(m => m.conflictStatus === 'clear')
  const allResolved = validated && conflictMembers.length === 0 && selectedMembers.every(m => isValidUsername(m.username))
    && (!createTeam || (!!teamId && !teamIdError))

  // ── 校验 ──
  const handleValidate = async () => {
    const selected = members.filter(m => m.selected)
    if (!selected.length) { toast.warning('请至少选择一个成员'); return }

    // 如果创建新团队，先校验团队标识
    if (createTeam) {
      if (!teamId.trim()) {
        setTeamIdError('请输入团队ID')
        return
      }
      if (!/^[a-zA-Z0-9_]+$/.test(teamId)) {
        setTeamIdError('团队ID只能包含英文字母、数字和下划线')
        return
      }
      if (teamId.length < 2) {
        setTeamIdError('团队ID至少2个字符')
        return
      }
      setTeamIdValidating(true)
      try {
        const res = await apiClient.get<{ valid: boolean; message?: string }>(`/api/teams/check-team-id?id=${encodeURIComponent(teamId)}`)
        if (res.success && res.data) {
          if (!res.data.valid) {
            setTeamIdError(res.data.message || '团队ID不可用')
            setTeamIdValidating(false)
            return
          }
        }
      } catch {
        // 校验接口失败不阻塞，继续成员校验
      }
      setTeamIdError('')
      setTeamIdValidating(false)
    }

    setValidatingMembers(true)
    try {
      const results = await onValidate(selected)

      // 合并结果
      const resultMap = new Map(results.map(r => [r.username, r]))

      setMembers(prev => prev.map(m => {
        if (!m.selected) return m

        // 本地格式校验
        let localConflicts: ConflictInfo[] = []
        if (!isValidUsername(m.username)) {
          localConflicts.push({
            type: 'invalid_username',
            message: `用户名 "${m.username}" 格式不正确，只能包含英文字母、数字、下划线、连字符和点号`
          })
        }

        const r = resultMap.get(m.username)

        if (!r) {
          if (localConflicts.length > 0) {
            return { ...m, conflictStatus: 'conflict', conflicts: localConflicts, action: 'create' }
          }
          return m
        }

        const allConflicts = [...localConflicts, ...(r.conflicts || [])]
        const finalStatus: ImportMember['conflictStatus'] = allConflicts.length > 0 ? 'conflict' : 'clear'

        // 自动决定 action（本校冲突默认邀请）
        let action: ImportMember['action'] = 'create'
        let inviteStudentId: string | undefined
        let inviteStudentName: string | undefined

        if (finalStatus === 'conflict' && localConflicts.length === 0) {
          const uc = r.conflicts.find(c => c.type === 'username_same_school')
          if (uc) {
            action = 'invite'
            inviteStudentId = uc.matchedStudentId
            inviteStudentName = uc.matchedStudentName
          } else {
            const nc = r.conflicts.find(c => c.type === 'name_same_school')
            if (nc) {
              action = 'invite'
              inviteStudentId = nc.matchedStudentId
              inviteStudentName = nc.matchedStudentName
            }
          }
        }

        return {
          ...m,
          conflictStatus: finalStatus,
          conflicts: allConflicts,
          action,
          inviteStudentId,
          inviteStudentName
        }
      }))

      setValidated(true)
    } catch {
      toast.error('校验失败')
    } finally {
      setValidatingMembers(false)
    }
  }

  // ── 成员操作 ──
  const updateMember = (index: number, updates: Partial<ImportMember>) => {
    setMembers(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], ...updates }
      return updated
    })
  }

  const removeMember = (index: number) => {
    setMembers(prev => prev.filter((_, i) => i !== index))
  }

  const toggleSelected = (index: number) => {
    updateMember(index, { selected: !members[index].selected })
  }

  const batchSetEnrollmentYear = () => {
    setMembers(prev => prev.map(m =>
      m.selected ? { ...m, enrollmentYear: batchEnrollmentYear } : m
    ))
  }

  // ── 问题解决 ──
  const handleInvite = (index: number, conflict: ConflictInfo) => {
    updateMember(index, {
      action: 'invite',
      inviteStudentId: conflict.matchedStudentId,
      inviteStudentName: conflict.matchedStudentName,
      conflictStatus: 'clear',
      conflicts: []
    })
  }

  const handleSkip = (index: number) => {
    updateMember(index, { action: 'skip', selected: false })
  }

  const handleIgnoreNameWarning = (index: number) => {
    updateMember(index, { action: 'create', conflictStatus: 'clear', conflicts: [] })
  }

  // ── 导入 ──
  const handleImport = async () => {
    const selected = members.filter(m => m.selected)
    if (!selected.length) { toast.warning('请至少选择一个成员'); return }
    const hasConflicts = selected.some(m => m.conflictStatus === 'conflict')
    if (hasConflicts) { toast.warning('请先解决所有问题'); return }

    setImporting(true)
    try {
      const result = await onImport(selected, { createTeam, visibility, teamName, teamId })
      if (result.success) {
        setImportResult(result)
      } else {
        toast.error(result.message || '导入失败')
      }
    } catch {
      toast.error('导入失败')
    } finally {
      setImporting(false)
    }
  }

  // ── 结果页 ──
  if (importResult) {
    return (
      <div style={cardStyle} className={unifiedStyles.resultCard}>
        <h2 className={unifiedStyles.u1}>
          导入完成
        </h2>

        <div className={unifiedStyles.u2}>
          {[
            [importResult.createdCount, '创建学生', 'var(--success)'],
            [importResult.invitedCount, '发送邀请', 'var(--primary)'],
            ...(importResult.errorCount > 0 ? [[importResult.errorCount, '失败', 'var(--error)']] : [])
          ].map(([count, label], i) => (
            <div key={i}>
              <div className={unifiedStyles.resultMetric} data-tone={i}>{count as number}</div>
              <div className={unifiedStyles.u3}>{label as string}</div>
            </div>
          ))}
        </div>

        {importResult.teamName && (
          <p className={unifiedStyles.u4}>
            已创建团队: <strong>{importResult.teamName}</strong>
          </p>
        )}
        {importResult.message && (
          <p className={unifiedStyles.u5}>{importResult.message}</p>
        )}

        {/* 新学生账号信息 */}
        {importResult.details?.filter((d: ImportResultDetail) => d.action === 'created').length > 0 && (
          <div className={unifiedStyles.u6}>
            <h3 className={unifiedStyles.u7}>新学生账号信息</h3>
            <p className={unifiedStyles.u8}>
              请妥善保存以下账号信息
            </p>
            <TableRoot className={unifiedStyles.u9}>
              <TableHead>
                <TableRow className={unifiedStyles.u10}>
                  <TableHeaderCell style={thStyle}>学生姓名</TableHeaderCell>
                  <TableHeaderCell style={thStyle}>登录用户名</TableHeaderCell>
                  <TableHeaderCell style={thStyle}>初始密码</TableHeaderCell>
                  <TableHeaderCell style={thStyle}>{platformUsernameLabel}</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {importResult.details
                  .filter((d: ImportResultDetail) => d.action === 'created')
                  .map((d: ImportResultDetail, i: number) => (
                    <TableRow key={i}>
                      <TableCell style={tdStyle}>{d.studentName || d.nickname}</TableCell>
                      <TableCell style={tdStyle} className={unifiedStyles.monospace}>{d.systemUsername}</TableCell>
                      <TableCell style={tdStyle} className={unifiedStyles.monospace}>{d.tempPassword}</TableCell>
                      <TableCell style={tdStyle}>{d.username}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </TableRoot>
          </div>
        )}

        <div className={unifiedStyles.u11}>
          <Button variant="primary" onClick={() => onComplete(importResult)}>
            返回团队列表
          </Button>
          {importResult.teamId && (
            <Button variant="outline" onClick={() => onComplete(importResult)}>
              查看团队
            </Button>
          )}
        </div>
      </div>
    )
  }

  // ── 预览页 ──
  return (
    <div style={cardStyle}>
      <h2 style={h2Style}>成员列表 (共 {members.length} 人，已选 {selectedMembers.length} 人)</h2>

      {/* 批量设置入学年份 */}
      <div style={batchBarStyle}>
        <span>批量设置入学年份:</span>
        <Select aria-label="选择" value={batchEnrollmentYear} disabled style={smallSelectStyle}>
          {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(year => (
            <option key={year} value={year}>{year}</option>
          ))}
        </Select>
        <Button variant="ghost" onClick={batchSetEnrollmentYear} style={smallBtnOutline}>应用</Button>
      </div>

      {/* 团队标识（仅创建新团队时显示） */}
      {createTeam && (
        <div className={unifiedStyles.teamIdPanel} data-error={Boolean(teamIdError)}>
          <span className={unifiedStyles.u12}>
            团队ID *:
          </span>
          <Input
            type="text"
            value={teamId}
            onChange={(e) => {
              const val = e.target.value
              setTeamId(val)
              // 实时格式校验
              if (val && !/^[a-zA-Z0-9_]*$/.test(val)) {
                setTeamIdError('只能包含英文字母、数字和下划线')
              } else if (val && val.length < 2) {
                setTeamIdError('至少2个字符')
              } else {
                setTeamIdError('')
              }
            }}
            placeholder="请输入团队ID（如 team_2024）"
            className={unifiedStyles.teamIdInput}
            aria-invalid={Boolean(teamIdError)}
          />
          {teamIdValidating && (
            <span className={unifiedStyles.u13}>校验中...</span>
          )}
          {!teamIdValidating && teamId && !teamIdError && (
            <span className={unifiedStyles.u14}>✓</span>
          )}
          {!teamIdValidating && teamIdError && (
            <span className={unifiedStyles.u15}>{teamIdError}</span>
          )}
          {!teamId && !teamIdError && (
            <span className={unifiedStyles.u13}>必填，创建后不可修改</span>
          )}
        </div>
      )}

      {/* 校验状态汇总 */}
      {validated && (
        <div className={unifiedStyles.validationSummary} data-resolved={allResolved}>
          <span className={unifiedStyles.u16}>
            {allResolved
              ? `全部通过，${clearedMembers.length} 人可以导入`
              : `发现 ${conflictMembers.length} 个问题需要解决（${clearedMembers.length} 人已通过）`
            }
          </span>
          {validated && clearedMembers.length > 0 && conflictMembers.length > 0 && (
            <Button variant="outline" size="sm"
              onClick={() => setShowCleared(!showCleared)}
            >
              {showCleared ? '隐藏已通过' : `显示 ${clearedMembers.length} 人已通过`}
            </Button>
          )}
        </div>
      )}

      {/* 成员列表 - 全部通过后隐藏 */}
      {!(validated && allResolved) && (
        <div className={unifiedStyles.u17}>
          {members.map((member, index) => {
            if (validated && member.conflictStatus === 'clear' && !showCleared) return null

            const hasConflict = member.conflictStatus === 'conflict'

            return (
              <div key={index} className={unifiedStyles.memberCard} data-conflict={hasConflict} data-selected={member.selected}>
                {/* 顶部行 */}
                <div className={unifiedStyles.u18}>
                  <Input type="checkbox" checked={member.selected} onChange={() => toggleSelected(index)} />
                  <span className={unifiedStyles.u19}>
                    {member.username}
                    {member.nickname && member.nickname !== member.username && (
                      <span className={unifiedStyles.u20}>
                        ({member.nickname})
                      </span>
                    )}
                  </span>
                  {validated && member.conflictStatus === 'clear' && (
                    <span className={unifiedStyles.u21}>✓ 通过</span>
                  )}
                  {validated && hasConflict && (
                    <span className={unifiedStyles.u22}>问题</span>
                  )}
                  <Button variant="ghost" onClick={() => removeMember(index)} className={unifiedStyles.u23}>删除</Button>
                </div>

                {/* 可编辑字段 */}
                <div className={unifiedStyles.u24}>
                  {/* 用户名 */}
                  <div className={unifiedStyles.u25}>
                    <span style={fieldLabelStyle}>用户名:</span>
                    <EditableField
                      value={member.username}
                      onChange={v => {
                        updateMember(index, { username: v, conflictStatus: 'unchecked' })
                        setValidated(false)
                      }}
                      style={inputStyle}
                      error={!!(member.username && !isValidUsername(member.username))}
                    />
                    {member.username && !isValidUsername(member.username) && (
                      <span className={unifiedStyles.u26}>
                        格式错误
                      </span>
                    )}
                  </div>

                  {/* 学生姓名 */}
                  <div className={unifiedStyles.u25}>
                    <span style={fieldLabelStyle}>姓名:</span>
                    <EditableField
                      value={member.studentName}
                      onChange={v => {
                        updateMember(index, { studentName: v, conflictStatus: 'unchecked' })
                        setValidated(false)
                      }}
                      style={inputStyle}
                    />
                  </div>

                  {/* 性别 */}
                  <div className={unifiedStyles.u25}>
                    <span style={fieldLabelStyle}>性别:</span>
                    <Select aria-label="选择"
                      value={member.gender}
                      onChange={e => updateMember(index, { gender: e.target.value })}
                      style={smallSelectStyle}
                    >
                      <option value="男">男</option>
                      <option value="女">女</option>
                    </Select>
                  </div>

                  {/* 入学年份 */}
                  <div className={unifiedStyles.u25}>
                    <span style={fieldLabelStyle}>入学年份:</span>
                    <Select aria-label="选择"
                      value={member.enrollmentYear || ''}
                      onChange={e => updateMember(index, { enrollmentYear: Number(e.target.value) })}
                      style={smallSelectStyle}
                    >
                      <option value="">请选择</option>
                      {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(year => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </Select>
                  </div>

                  {/* 问题详情 */}
                  {hasConflict && member.conflicts.map((conflict, ci) => {
                    const label = CONFLICT_LABELS[conflict.type] || { text: '未知问题', color: 'var(--text-muted)' }
                    return (
                      <div key={ci} className={unifiedStyles.conflictCard} style={conflictColorStyle(label.color)}>
                        <div className={unifiedStyles.u18}>
                          <span className={unifiedStyles.conflictBadge}>
                            {label.text}
                          </span>
                        </div>
                        <p className={unifiedStyles.u27}>
                          {conflict.message}
                        </p>

                        {/* 解决方案按钮组 */}
                        <div className={unifiedStyles.u28}>
                          {/* 发起邀请（本校冲突且匹配到学生时可用，默认选中） */}
                          {(conflict.type === 'username_same_school' || conflict.type === 'name_same_school') && conflict.matchedStudentId && (
                            <Button variant="ghost" onClick={() => handleInvite(index, conflict)} className={unifiedStyles.u29}>
                              ✓ 发起邀请给 {conflict.matchedStudentName}
                            </Button>
                          )}

                          {/* 修改用户名（用户名冲突或格式错误可用） */}
                          {(conflict.type === 'username_same_school' || conflict.type === 'username_diff_school' || conflict.type === 'invalid_username') && (
                            <span className={unifiedStyles.u30}>
                              ✎ 修改上方用户名后重新校验
                            </span>
                          )}

                          {/* 修改姓名（姓名冲突可用） */}
                          {conflict.type === 'name_same_school' && (
                            <span className={unifiedStyles.u30}>
                              ✎ 修改上方姓名后重新校验
                            </span>
                          )}

                          {/* 忽略警告（仅本校姓名冲突） */}
                          {conflict.type === 'name_same_school' && (
                            <Button variant="ghost" onClick={() => handleIgnoreNameWarning(index)} className={unifiedStyles.u31}>
                              忽略警告，创建新学生
                            </Button>
                          )}

                          {/* 删除（所有冲突类型可用） */}
                          <Button variant="ghost" onClick={() => removeMember(index)} className={unifiedStyles.u32}>
                            从列表移除
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 全部通过后显示导入确认区 */}
      {validated && allResolved && (
        <div className={unifiedStyles.u33}>
          <div className={unifiedStyles.u34}>
            校验全部通过
          </div>
          <p className={unifiedStyles.u35}>
            共 {selectedMembers.length} 人准备导入，点击下方按钮执行导入
          </p>
        </div>
      )}

      {/* 底部操作栏 */}
      <div className={unifiedStyles.u36}>
        <Button variant="ghost" onClick={onBack} style={btnSecondary}>上一步</Button>
        <div className={unifiedStyles.u37}>
          <Button variant="outline"
            onClick={handleValidate}
            disabled={validatingMembers || selectedMembers.length === 0}
          >
            {validatingMembers ? '校验中...' : validated ? '重新校验' : '校验'}
          </Button>
          {validated && allResolved && (
            <Button variant="primary"
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? '导入中...' : `确认导入 (${selectedMembers.length} 人)`}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 样式常量 ──

const cardStyle: React.CSSProperties = {
  background: 'white', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border)'
}

const h2Style: React.CSSProperties = {
  fontSize: '1.125rem', fontWeight: 'bold', marginBottom: '1rem'
}

const btnPrimary: React.CSSProperties = {
  padding: '0.5rem 1rem', border: 'none', borderRadius: '6px',
  background: 'var(--primary)', color: 'white', cursor: 'pointer'
}

const btnSecondary: React.CSSProperties = {
  padding: '0.5rem 1rem', border: '1px solid var(--border)', borderRadius: '6px',
  background: 'white', cursor: 'pointer'
}

const btnOutline: React.CSSProperties = {
  padding: '0.5rem 1rem', border: '1px solid var(--primary)', borderRadius: '6px',
  background: 'white', color: 'var(--primary)', cursor: 'pointer'
}

const inputStyle: React.CSSProperties = {
  padding: '0.25rem 0.5rem', border: '1px solid var(--border)',
  borderRadius: '4px', flex: 1, fontSize: '0.875rem'
}

const smallSelectStyle: React.CSSProperties = {
  padding: '0.25rem 0.5rem', border: '1px solid var(--border)', borderRadius: '4px'
}

const smallBtnOutline: React.CSSProperties = {
  padding: '0.25rem 0.5rem', border: '1px solid var(--primary)', borderRadius: '4px',
  background: 'white', color: 'var(--primary)', cursor: 'pointer'
}

const batchBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem',
  padding: '0.75rem', background: 'var(--gray-50)', borderRadius: '6px'
}

const fieldLabelStyle: React.CSSProperties = {
  color: 'var(--gray-500)', minWidth: '70px', fontSize: '0.875rem'
}

const thStyle: React.CSSProperties = {
  padding: '0.5rem', border: '1px solid var(--border)', textAlign: 'left'
}

const tdStyle: React.CSSProperties = {
  padding: '0.5rem', border: '1px solid var(--border)'
}
