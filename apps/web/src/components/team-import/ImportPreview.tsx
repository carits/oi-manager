'use client'

import { useState, useEffect, useRef } from 'react'
import {
  type ImportMember,
  type ConflictInfo,
  type ValidateResultItem,
  type ImportResult,
  type ImportResultDetail,
  CONFLICT_LABELS,
  isValidUsername
} from './types'

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
    <input
      type="text"
      value={local}
      onChange={e => setLocal(e.target.value)}
      onFocus={() => { focused.current = true }}
      onBlur={() => {
        focused.current = false
        if (local !== value) onChange(local)
      }}
      style={{
        ...style,
        ...(error ? { borderColor: '#ef4444', background: '#fef2f2' } : {}),
      }}
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
  onValidate,
  onImport,
  onBack,
  onComplete
}: ImportPreviewProps) {
  const [members, setMembers] = useState<ImportMember[]>(initialMembers)
  const [batchEnrollmentYear] = useState(new Date().getFullYear())
  const [showCleared, setShowCleared] = useState(false)

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

  // ── 校验 ──
  const handleValidate = async () => {
    const selected = members.filter(m => m.selected)
    if (!selected.length) return alert('请至少选择一个成员')

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
      alert('校验失败')
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
    if (!selected.length) return alert('请至少选择一个成员')
    const hasConflicts = selected.some(m => m.conflictStatus === 'conflict')
    if (hasConflicts) return alert('请先解决所有问题')

    setImporting(true)
    try {
      const result = await onImport(selected, { createTeam, visibility, teamName })
      if (result.success) {
        setImportResult(result)
      } else {
        alert(result.message || '导入失败')
      }
    } catch {
      alert('导入失败')
    } finally {
      setImporting(false)
    }
  }

  // ── 结果页 ──
  if (importResult) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem', color: 'var(--success)' }}>
          导入完成
        </h2>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginBottom: '1.5rem' }}>
          {[
            [importResult.createdCount, '创建学生', 'var(--success)'],
            [importResult.invitedCount, '发送邀请', 'var(--primary)'],
            ...(importResult.errorCount > 0 ? [[importResult.errorCount, '失败', 'var(--error)']] : [])
          ].map(([count, label, color], i) => (
            <div key={i}>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: color as string }}>{count as number}</div>
              <div style={{ color: 'var(--gray-500)' }}>{label as string}</div>
            </div>
          ))}
        </div>

        {importResult.teamName && (
          <p style={{ color: 'var(--gray-500)', marginBottom: '0.5rem' }}>
            已创建团队: <strong>{importResult.teamName}</strong>
          </p>
        )}
        {importResult.message && (
          <p style={{ color: 'var(--gray-500)', marginBottom: '1.5rem' }}>{importResult.message}</p>
        )}

        {/* 新学生账号信息 */}
        {importResult.details?.filter((d: ImportResultDetail) => d.action === 'created').length > 0 && (
          <div style={{ marginTop: '1rem', marginBottom: '1.5rem', textAlign: 'left' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem' }}>新学生账号信息</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginBottom: '0.75rem' }}>
              请妥善保存以下账号信息
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)' }}>
                  <th style={thStyle}>学生姓名</th>
                  <th style={thStyle}>登录用户名</th>
                  <th style={thStyle}>初始密码</th>
                  <th style={thStyle}>{platformUsernameLabel}</th>
                </tr>
              </thead>
              <tbody>
                {importResult.details
                  .filter((d: ImportResultDetail) => d.action === 'created')
                  .map((d: ImportResultDetail, i: number) => (
                    <tr key={i}>
                      <td style={tdStyle}>{d.studentName || d.nickname}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{d.systemUsername}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{d.tempPassword}</td>
                      <td style={tdStyle}>{d.username}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
          <button onClick={() => onComplete(importResult)} style={btnPrimary}>
            返回团队列表
          </button>
          {importResult.teamId && (
            <button onClick={() => onComplete(importResult)} style={btnOutline}>
              查看团队
            </button>
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
        <select value={batchEnrollmentYear} disabled style={smallSelectStyle}>
          {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(year => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
        <button onClick={batchSetEnrollmentYear} style={smallBtnOutline}>应用</button>
      </div>

      {/* 校验状态汇总 */}
      {validated && (
        <div style={{
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          borderRadius: '6px',
          background: allResolved ? '#f0fdf4' : '#fefce8',
          border: `1px solid ${allResolved ? '#bbf7d0' : '#fef08a'}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: '0.875rem' }}>
            {allResolved
              ? `✅ 全部通过！${clearedMembers.length} 人可以导入`
              : `⚠ 发现 ${conflictMembers.length} 个问题需要解决（${clearedMembers.length} 人已通过）`
            }
          </span>
          {validated && clearedMembers.length > 0 && conflictMembers.length > 0 && (
            <button
              onClick={() => setShowCleared(!showCleared)}
              style={{ ...smallBtnOutline, fontSize: '0.75rem' }}
            >
              {showCleared ? '隐藏已通过' : `显示 ${clearedMembers.length} 人已通过`}
            </button>
          )}
        </div>
      )}

      {/* 成员列表 - 全部通过后隐藏 */}
      {!(validated && allResolved) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {members.map((member, index) => {
            if (validated && member.conflictStatus === 'clear' && !showCleared) return null

            const hasConflict = member.conflictStatus === 'conflict'

            return (
              <div key={index} style={{
                padding: '1rem',
                border: `1px solid ${hasConflict ? '#fca5a5' : 'var(--border)'}`,
                borderRadius: '6px',
                background: !member.selected ? 'var(--gray-50)' : hasConflict ? '#fff5f5' : 'white'
              }}>
                {/* 顶部行 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <input type="checkbox" checked={member.selected} onChange={() => toggleSelected(index)} />
                  <span style={{ fontWeight: 600, flex: 1 }}>
                    {member.username}
                    {member.nickname && member.nickname !== member.username && (
                      <span style={{ color: 'var(--gray-400)', fontWeight: 400, marginLeft: '0.5rem' }}>
                        ({member.nickname})
                      </span>
                    )}
                  </span>
                  {validated && member.conflictStatus === 'clear' && (
                    <span style={{
                      padding: '0.125rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem',
                      background: '#dcfce7', color: '#166534'
                    }}>✓ 通过</span>
                  )}
                  {validated && hasConflict && (
                    <span style={{
                      padding: '0.125rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem',
                      background: '#fee2e2', color: '#991b1b'
                    }}>问题</span>
                  )}
                  <button onClick={() => removeMember(index)} style={{
                    padding: '0.25rem 0.5rem', border: '1px solid var(--error)', borderRadius: '4px',
                    background: 'white', color: 'var(--error)', cursor: 'pointer', fontSize: '0.875rem'
                  }}>删除</button>
                </div>

                {/* 可编辑字段 */}
                <div style={{ marginLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {/* 用户名 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={fieldLabelStyle}>用户名:</span>
                    <EditableField
                      value={member.username}
                      onChange={v => {
                        updateMember(index, { username: v, conflictStatus: 'unchecked' })
                        setValidated(false)
                      }}
                      style={{
                        ...inputStyle,
                        borderColor: member.username && !isValidUsername(member.username) ? '#ef4444' : undefined,
                        background: member.username && !isValidUsername(member.username) ? '#fef2f2' : undefined
                      }}
                      error={!!(member.username && !isValidUsername(member.username))}
                    />
                    {member.username && !isValidUsername(member.username) && (
                      <span style={{ color: '#ef4444', fontSize: '0.75rem', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        ⚠ 格式错误
                      </span>
                    )}
                  </div>

                  {/* 学生姓名 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={fieldLabelStyle}>性别:</span>
                    <select
                      value={member.gender}
                      onChange={e => updateMember(index, { gender: e.target.value })}
                      style={smallSelectStyle}
                    >
                      <option value="男">男</option>
                      <option value="女">女</option>
                    </select>
                  </div>

                  {/* 入学年份 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={fieldLabelStyle}>入学年份:</span>
                    <select
                      value={member.enrollmentYear || ''}
                      onChange={e => updateMember(index, { enrollmentYear: Number(e.target.value) })}
                      style={smallSelectStyle}
                    >
                      <option value="">请选择</option>
                      {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(year => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </select>
                  </div>

                  {/* 问题详情 */}
                  {hasConflict && member.conflicts.map((conflict, ci) => {
                    const label = CONFLICT_LABELS[conflict.type] || { text: '未知问题', color: '#999' }
                    return (
                      <div key={ci} style={{
                        marginTop: '0.5rem',
                        padding: '0.75rem',
                        background: '#fff',
                        border: `1px solid ${label.color}33`,
                        borderRadius: '6px',
                        borderLeft: `3px solid ${label.color}`
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                          <span style={{
                            padding: '0.125rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem',
                            background: `${label.color}22`, color: label.color, fontWeight: 600
                          }}>
                            {label.text}
                          </span>
                        </div>
                        <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '0.5rem', margin: 0 }}>
                          {conflict.message}
                        </p>

                        {/* 解决方案按钮组 */}
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          {/* 发起邀请（本校冲突且匹配到学生时可用，默认选中） */}
                          {(conflict.type === 'username_same_school' || conflict.type === 'name_same_school') && conflict.matchedStudentId && (
                            <button onClick={() => handleInvite(index, conflict)} style={{
                              padding: '0.25rem 0.625rem', borderRadius: '4px',
                              background: 'var(--primary)', color: 'white', border: 'none',
                              cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
                              boxShadow: '0 1px 2px rgba(59,130,246,0.3)'
                            }}>
                              ✓ 发起邀请给 {conflict.matchedStudentName}
                            </button>
                          )}

                          {/* 修改用户名（用户名冲突或格式错误可用） */}
                          {(conflict.type === 'username_same_school' || conflict.type === 'username_diff_school' || conflict.type === 'invalid_username') && (
                            <span style={{
                              padding: '0.25rem 0.625rem', borderRadius: '4px',
                              background: 'var(--gray-100)', color: 'var(--gray-600)', fontSize: '0.8rem',
                              border: '1px solid var(--gray-200)'
                            }}>
                              ✎ 修改上方用户名后重新校验
                            </span>
                          )}

                          {/* 修改姓名（姓名冲突可用） */}
                          {conflict.type === 'name_same_school' && (
                            <span style={{
                              padding: '0.25rem 0.625rem', borderRadius: '4px',
                              background: 'var(--gray-100)', color: 'var(--gray-600)', fontSize: '0.8rem',
                              border: '1px solid var(--gray-200)'
                            }}>
                              ✎ 修改上方姓名后重新校验
                            </span>
                          )}

                          {/* 忽略警告（仅本校姓名冲突） */}
                          {conflict.type === 'name_same_school' && (
                            <button onClick={() => handleIgnoreNameWarning(index)} style={{
                              padding: '0.25rem 0.625rem', borderRadius: '4px',
                              background: 'white', color: 'var(--warning)', border: '1px solid var(--warning)',
                              cursor: 'pointer', fontSize: '0.8rem'
                            }}>
                              忽略警告，创建新学生
                            </button>
                          )}

                          {/* 删除（所有冲突类型可用） */}
                          <button onClick={() => removeMember(index)} style={{
                            padding: '0.25rem 0.625rem', borderRadius: '4px',
                            background: 'white', color: 'var(--error)', border: '1px solid var(--error)',
                            cursor: 'pointer', fontSize: '0.8rem'
                          }}>
                            ✕ 从列表移除
                          </button>
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
        <div style={{
          padding: '1.5rem',
          background: '#f0fdf4',
          borderRadius: '8px',
          border: '1px solid #bbf7d0',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '1.125rem', fontWeight: 600, color: '#166534', marginBottom: '0.5rem' }}>
            ✅ 校验全部通过
          </div>
          <p style={{ color: '#15803d', margin: 0 }}>
            共 {selectedMembers.length} 人准备导入，点击下方按钮执行导入
          </p>
        </div>
      )}

      {/* 底部操作栏 */}
      <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={onBack} style={btnSecondary}>上一步</button>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={handleValidate}
            disabled={validatingMembers || selectedMembers.length === 0}
            style={{
              ...btnOutline,
              opacity: validatingMembers || selectedMembers.length === 0 ? 0.7 : 1
            }}
          >
            {validatingMembers ? '校验中...' : validated ? '重新校验' : '校验'}
          </button>
          {validated && allResolved && (
            <button
              onClick={handleImport}
              disabled={importing}
              style={{
                ...btnPrimary,
                opacity: importing ? 0.7 : 1,
                cursor: importing ? 'not-allowed' : 'pointer'
              }}
            >
              {importing ? '导入中...' : `确认导入 (${selectedMembers.length} 人)`}
            </button>
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
