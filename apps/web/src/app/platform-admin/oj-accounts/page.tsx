'use client'

import { useEffect, useState, useCallback } from 'react'
import { TableRoot, TableHead, TableBody, TableRow, TableHeaderCell, TableCell } from '@/components/ui/TablePrimitives'
import unifiedStyles from './page.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import apiClient from '@/lib/apiClient'
import { OJ_PLATFORM_LABEL_MAP, OJ_PLATFORMS_NO_ALL } from '@/lib/oj-platforms'
import { Button } from '@/components/ui/Button'
import { FormDialog } from '@/components/ui/Dialogs'
import { useToast } from '@/components/ui/Toast'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { PageLoadingFrame } from '@/components/ui/PageLoadingFrame'

interface OjAccount {
  id: string
  platform: string
  username: string
  loginMethod: string
  status: string
  lastLoginAt: string | null
  lastErrorMessage: string | null
  hasPassword: boolean
  hasCookie: boolean
  createdAt: string
  enabled: boolean
  priority: number
  maxConsecutiveFailures: number
  freezeDurationMinutes: number
  submitMaxRetries: number
  retryIntervalSeconds: number
  loginFailureCooldownMinutes: number
  cookieValidMinutes: number
  reverifyIntervalMinutes: number
  renewLoginThresholdMinutes: number
  minSubmitIntervalSeconds: number
  minRequestIntervalSeconds: number
  maxConcurrentSubmissions: number
  maxConcurrentRequests: number
  firstPollDelaySeconds: number
  pollIntervalSeconds: number
  maxWaitDurationMinutes: number
  rateLimitThreshold: number
  banSuspicionCooldownHours: number
  autoVerifyIntervalMinutes: number
}

interface PlatformStats {
  platform: string
  total: number
  active: number
  expired: number
  error: number
  unverified: number
  lastExpiredAt: string | null
  totalSubmissions: number
  totalSubmissionErrors: number
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: '有效', color: 'var(--success)' },
  expired: { label: '已失效', color: 'var(--error)' },
  error: { label: '错误', color: 'var(--warning)' },
  unverified: { label: '未验证', color: 'var(--text-secondary)' },
}

export default function OjAccountsPage() {
  const toast = useToast()
  const [accounts, setAccounts] = useState<OjAccount[]>([])
  const [stats, setStats] = useState<PlatformStats[]>([])
  const [loading, setLoading] = useState(true)
  const [filterPlatform, setFilterPlatform] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [loggingIn, setLoggingIn] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<OjAccount | null>(null)
  const [editTarget, setEditTarget] = useState<OjAccount | null>(null)

  const fetchAccounts = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filterPlatform) params.set('platform', filterPlatform)
      if (filterStatus) params.set('status', filterStatus)
      const result = await apiClient.get<OjAccount[]>(`/api/oj-accounts?${params}`)
      if (result.success) setAccounts(result.data || [])
    } catch (error) {
      console.error('Failed to fetch accounts:', error)
    }
  }, [filterPlatform, filterStatus])

  const fetchStats = useCallback(async () => {
    try {
      const result = await apiClient.get<PlatformStats[]>('/api/oj-accounts/stats')
      if (result.success) setStats(result.data || [])
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAccounts()
    fetchStats()
  }, [fetchAccounts, fetchStats])

  const handleVerify = async (id: string) => {
    setVerifying(id)
    try {
      const result = await apiClient.post<any>(`/api/oj-accounts/${id}/verify`)
      if (result.success) {
        toast.success(`验证结果: ${result.data?.message || '验证成功'}`)
        fetchAccounts()
        fetchStats()
      } else {
        toast.error(result.message || '验证失败')
      }
    } catch {
      toast.error('验证失败')
    } finally {
      setVerifying(null)
    }
  }

  const handleLogin = async (id: string) => {
    setLoggingIn(id)
    try {
      const result = await apiClient.post<any>(`/api/oj-accounts/${id}/login`)
      if (result.success) {
        toast.success('登录成功，Cookie 已更新')
        fetchAccounts()
        fetchStats()
      } else {
        toast.error(result.data?.message || result.message || '登录失败')
      }
    } catch {
      toast.error('登录失败')
    } finally {
      setLoggingIn(null)
    }
  }

  const handleBatchVerify = async () => {
    try {
      const result = await apiClient.post('/api/oj-accounts/batch-verify')
      if (result.success) {
        const data = result.data as Array<{ valid: boolean }>
        const valid = data.filter(d => d.valid).length
        toast.success(`批量验证完成: ${valid}/${data.length} 个有效`)
        fetchAccounts()
        fetchStats()
      }
    } catch {
      toast.error('批量验证失败')
    }
  }

  const handleRemove = async () => {
    if (!removeTarget) return
    try {
      const result = await apiClient.delete(`/api/oj-accounts/${removeTarget.id}`)
      if (result.success) {
        toast.success('已删除')
        setRemoveTarget(null)
        fetchAccounts()
        fetchStats()
      } else {
        toast.error(result.message || '删除失败')
      }
    } catch {
      toast.error('删除失败')
    }
  }

  if (loading) {
    return <PageLoadingFrame title="OJ 账号管理" />
  }

  return (
    <>
        <div className={unifiedStyles.u1}>
          <div className={unifiedStyles.u2}>
            <div className={unifiedStyles.u3}>
              <h2 className={unifiedStyles.u4}>提交管理 — OJ 账号池</h2>
              <div className={unifiedStyles.u5}>
                <Button onClick={handleBatchVerify}>批量验证</Button>
                <Button onClick={() => setShowAddModal(true)}>+ 添加账号</Button>
              </div>
            </div>

            {/* 统计卡片 */}
            {stats.length > 0 && (
              <div className={unifiedStyles.u6}>
                {stats.map(s => {
                  const statusCfg = s.active === s.total ? STATUS_CONFIG.active : s.active === 0 ? STATUS_CONFIG.expired : STATUS_CONFIG.unverified
                  return (
                    <div
                      key={s.platform}
                      className={unifiedStyles.u7}
                      onClick={() => setFilterPlatform(filterPlatform === s.platform ? '' : s.platform)}
                    >
                      <div className={unifiedStyles.u8}>
                        {OJ_PLATFORM_LABEL_MAP[s.platform] || s.platform}
                      </div>
                      <div className={unifiedStyles.u4}>
                        <span style={{ color: statusCfg.color }}>{s.active}</span>
                        <span className={unifiedStyles.u9}> / {s.total}</span>
                      </div>
                      {s.expired > 0 && (
                        <div className={unifiedStyles.u10}>
                          {s.expired} 个已失效
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* 柱形图 */}
            {(() => {
              // 只展示有数据的平台，避免空柱太多
              const platformMap = new Map<string, string>()
              for (const s of stats) {
                platformMap.set(s.platform, OJ_PLATFORM_LABEL_MAP[s.platform] || s.platform)
              }
              const platforms = Array.from(platformMap.entries())

              return (
                <div className={unifiedStyles.u11}>
                  {[
                    { title: '平台有效账号数', key: 'active', color: 'var(--success)' },
                    { title: '平台失效账号数', key: 'expired', color: 'var(--error)' },
                    { title: '平台提交数', key: 'totalSubmissions', color: 'var(--primary)' },
                    { title: '平台提交失败数', key: 'totalSubmissionErrors', color: 'var(--warning)' },
                  ].map(({ title, key, color }) => (
                    <div key={key} className={unifiedStyles.u12}>
                      <div className={unifiedStyles.u13}>{title}</div>
                      <div className={unifiedStyles.u14}>
                        <div style={{ width: Math.max(platforms.length * 70, 300), height: 200 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={platforms.map(([id, label]) => {
                              const s = stats.find(st => st.platform === id)
                              return {
                                name: label,
                                value: (s as any)?.[key] || 0,
                              }
                            })} margin={{ left: -10 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                              <Tooltip />
                              <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} name={title} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* 筛选栏 */}
            <div className={unifiedStyles.u15}>
              <Select aria-label="选择"
                value={filterPlatform}
                onChange={e => setFilterPlatform(e.target.value)}
                className={unifiedStyles.u16}
              >
                <option value="">全部平台</option>
                {OJ_PLATFORMS_NO_ALL.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </Select>
              <Select aria-label="选择"
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                className={unifiedStyles.u16}
              >
                <option value="">全部状态</option>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </Select>
            </div>

            {/* 账号表格 */}
            <div className={unifiedStyles.u17}>
              <TableRoot className={unifiedStyles.u18}>
                <TableHead>
                  <TableRow className={unifiedStyles.u19}>
                    <TableHeaderCell className={unifiedStyles.u20}>平台</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u20}>用户名</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u21}>启用</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u21}>优先级</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u20}>状态</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u20}>最后登录</TableHeaderCell>
                    <TableHeaderCell className={unifiedStyles.u20}>操作</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {accounts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className={unifiedStyles.u22}>
                        暂无账号，点击「添加账号」开始配置
                      </TableCell>
                    </TableRow>
                  ) : accounts.map(acc => {
                    const sc = STATUS_CONFIG[acc.status] || STATUS_CONFIG.unverified
                    return (
                      <TableRow key={acc.id} style={{ borderBottom: '1px solid var(--border)', opacity: acc.enabled ? 1 : 0.5 }}>
                        <TableCell className={unifiedStyles.u23}>{OJ_PLATFORM_LABEL_MAP[acc.platform] || acc.platform}</TableCell>
                        <TableCell className={unifiedStyles.u24}>{acc.username}</TableCell>
                        <TableCell className={unifiedStyles.u21}>
                          <span style={{ color: acc.enabled ? 'var(--success)' : 'var(--error)', fontSize: '0.8rem', fontWeight: 500 }}>
                            {acc.enabled ? '启用' : '停用'}
                          </span>
                        </TableCell>
                        <TableCell className={unifiedStyles.u25}>{acc.priority}</TableCell>
                        <TableCell className={unifiedStyles.u23}>
                          <span style={{
                            padding: '0.15rem 0.5rem',
                            borderRadius: 'var(--radius-lg)',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            color: sc.color,
                            background: `${sc.color}15`,
                          }}>
                            {sc.label}
                          </span>
                        </TableCell>
                        <TableCell className={unifiedStyles.u26}>
                          {acc.lastLoginAt ? new Date(acc.lastLoginAt).toLocaleString('zh-CN') : '-'}
                        </TableCell>
                        <TableCell className={unifiedStyles.u23}>
                          <div className={unifiedStyles.u27}>
                            <Button variant="ghost"
                              onClick={() => setEditTarget(acc)}
                              className={unifiedStyles.u28}
                            >
                              编辑
                            </Button>
                            <Button variant="ghost"
                              onClick={() => handleVerify(acc.id)}
                              disabled={verifying === acc.id}
                              className={unifiedStyles.u28}
                            >
                              {verifying === acc.id ? '...' : '验证'}
                            </Button>
                            {acc.hasPassword && (
                              <Button variant="ghost"
                                onClick={() => handleLogin(acc.id)}
                                disabled={loggingIn === acc.id}
                                className={unifiedStyles.u28}
                              >
                                {loggingIn === acc.id ? '...' : '登录'}
                              </Button>
                            )}
                            <Button variant="ghost"
                              onClick={() => setRemoveTarget(acc)}
                              className={unifiedStyles.u29}
                            >
                              删除
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </TableRoot>
            </div>
          </div>
        </div>

        {/* 添加账号弹窗 */}
        <AddAccountModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false)
            fetchAccounts()
            fetchStats()
          }}
        />

        {/* 编辑配置弹窗 */}
        <EditAccountModal
          isOpen={!!editTarget}
          onClose={() => setEditTarget(null)}
          account={editTarget}
          onSuccess={() => {
            setEditTarget(null)
            fetchAccounts()
            fetchStats()
          }}
        />

        {/* 删除确认 */}
        <ConfirmModal
          isOpen={!!removeTarget}
          onClose={() => setRemoveTarget(null)}
          onConfirm={handleRemove}
          title="删除账号"
          message={`确定要删除 ${OJ_PLATFORM_LABEL_MAP[removeTarget?.platform || ''] || removeTarget?.platform} 账号「${removeTarget?.username}」吗？`}
          confirmText="删除"
          danger
        />
    </>
  )
}

// ==================== 添加账号弹窗 ====================

function AddAccountModal({ isOpen, onClose, onSuccess }: {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const toast = useToast()
  const [platform, setPlatform] = useState('hdu')
  const [username, setUsername] = useState('')
  const [loginMethod, setLoginMethod] = useState<'cookie' | 'password'>('cookie')
  const [cookie, setCookie] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!platform || !username) {
      toast.warning('平台和用户名必填')
      return
    }
    if (loginMethod === 'cookie' && !cookie) {
      toast.warning('请输入 Cookie')
      return
    }
    if (loginMethod === 'password' && !password) {
      toast.warning('请输入密码')
      return
    }

    setSubmitting(true)
    try {
      const body: any = { platform, username, loginMethod }
      if (loginMethod === 'cookie') body.cookie = cookie
      else body.password = password

      const result = await apiClient.post<any>('/api/oj-accounts', body)
      if (result.success) {
        toast.success('添加成功')
        // 自动验证
        if (result.data?.id) {
          await apiClient.post(`/api/oj-accounts/${result.data.id}/verify`)
        }
        // 重置表单
        setUsername('')
        setCookie('')
        setPassword('')
        onSuccess()
      } else {
        toast.error(result.message || '添加失败')
      }
    } catch {
      toast.error('添加失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <FormDialog isOpen={isOpen} onClose={onClose} title="添加 OJ 平台账号" size="md">
      <div className={unifiedStyles.u30}>
        <div>
          <label className={unifiedStyles.u31}>平台</label>
          <Select aria-label="选择"
            value={platform}
            onChange={e => setPlatform(e.target.value)}
            className={unifiedStyles.u32}
          >
            {OJ_PLATFORMS_NO_ALL.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>
        </div>

        <div>
          <label className={unifiedStyles.u31}>用户名</label>
          <Input
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="平台上的用户名"
            className={unifiedStyles.u32}
          />
        </div>

        <div>
          <label className={unifiedStyles.u31}>登录方式</label>
          <div className={unifiedStyles.u33}>
            <label className={unifiedStyles.u34}>
              <Input type="radio" checked={loginMethod === 'cookie'} onChange={() => setLoginMethod('cookie')} />
              Cookie
            </label>
            <label className={unifiedStyles.u34}>
              <Input type="radio" checked={loginMethod === 'password'} onChange={() => setLoginMethod('password')} />
              账号密码
            </label>
          </div>
        </div>

        {loginMethod === 'cookie' ? (
          <div>
            <label className={unifiedStyles.u31}>Cookie</label>
            <Textarea
              value={cookie}
              onChange={e => setCookie(e.target.value)}
              placeholder="从浏览器开发者工具中复制 Cookie（格式如 key1=value1; key2=value2）"
              rows={4}
              className={unifiedStyles.u35}
            />
          </div>
        ) : (
          <div>
            <label className={unifiedStyles.u31}>密码</label>
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="平台登录密码（AES 加密存储）"
              className={unifiedStyles.u32}
            />
          </div>
        )}

        <div className={unifiedStyles.u36}>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '添加中...' : '添加并验证'}
          </Button>
        </div>
      </div>
    </FormDialog>
  )
}

// ==================== 编辑配置弹窗 ====================

const CONFIG_FIELDS = [
  { group: '基础配置', fields: [
    { key: 'enabled', label: '是否启用', type: 'boolean' as const },
    { key: 'priority', label: '优先级', type: 'number' as const, unit: '（越大越优先）' },
  ]},
  { group: '失败控制', fields: [
    { key: 'maxConsecutiveFailures', label: '最大连续失败次数', type: 'number' as const },
    { key: 'freezeDurationMinutes', label: '异常后冻结时间', type: 'number' as const, unit: '分钟' },
    { key: 'submitMaxRetries', label: '提交失败最大重试次数', type: 'number' as const },
    { key: 'retryIntervalSeconds', label: '重试间隔', type: 'number' as const, unit: '秒' },
  ]},
  { group: '限流控制', fields: [
    { key: 'minSubmitIntervalSeconds', label: '最小提交间隔', type: 'number' as const, unit: '秒' },
    { key: 'minRequestIntervalSeconds', label: '最小请求间隔', type: 'number' as const, unit: '秒' },
    { key: 'maxConcurrentSubmissions', label: '单账号最大并发提交数', type: 'number' as const },
    { key: 'maxConcurrentRequests', label: '单账号最大并发请求数', type: 'number' as const },
  ]},
  { group: '登录控制', fields: [
    { key: 'loginFailureCooldownMinutes', label: '登录失败冷却时间', type: 'number' as const, unit: '分钟' },
    { key: 'cookieValidMinutes', label: 'Cookie 预期有效期', type: 'number' as const, unit: '分钟' },
    { key: 'renewLoginThresholdMinutes', label: '提前续登阈值', type: 'number' as const, unit: '分钟' },
    { key: 'reverifyIntervalMinutes', label: '重新验证时间间隔', type: 'number' as const, unit: '分钟' },
  ]},
  { group: '轮询控制', fields: [
    { key: 'firstPollDelaySeconds', label: '首次查询延迟', type: 'number' as const, unit: '秒' },
    { key: 'pollIntervalSeconds', label: '轮询间隔', type: 'number' as const, unit: '秒' },
    { key: 'maxWaitDurationMinutes', label: '最长等待时长', type: 'number' as const, unit: '分钟' },
  ]},
  { group: '封禁保护', fields: [
    { key: 'rateLimitThreshold', label: '403/429 连续阈值', type: 'number' as const },
    { key: 'banSuspicionCooldownHours', label: '封禁怀疑冷却时间', type: 'number' as const, unit: '小时' },
    { key: 'autoVerifyIntervalMinutes', label: '自动验证时间', type: 'number' as const, unit: '分钟' },
  ]},
]

type ConfigKey = keyof OjAccount

function EditAccountModal({ isOpen, onClose, account, onSuccess }: {
  isOpen: boolean
  onClose: () => void
  account: OjAccount | null
  onSuccess: () => void
}) {
  const toast = useToast()
  const [form, setForm] = useState<Record<string, any>>({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (account) {
      const initial: Record<string, any> = {}
      for (const group of CONFIG_FIELDS) {
        for (const f of group.fields) {
          initial[f.key] = (account as any)[f.key]
        }
      }
      setForm(initial)
    }
  }, [account])

  const handleSubmit = async () => {
    if (!account) return
    setSubmitting(true)
    try {
      const result = await apiClient.put(`/api/oj-accounts/${account.id}`, form)
      if (result.success) {
        toast.success('配置已保存')
        onSuccess()
      } else {
        toast.error(result.message || '保存失败')
      }
    } catch {
      toast.error('保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (!account) return null

  return (
    <FormDialog isOpen={isOpen} onClose={onClose} title={`编辑配置 — ${OJ_PLATFORM_LABEL_MAP[account.platform] || account.platform} / ${account.username}`} size="lg">
      <div className={unifiedStyles.u37}>
        {CONFIG_FIELDS.map(group => (
          <div key={group.group}>
            <div className={unifiedStyles.u38}>
              {group.group}
            </div>
            <div className={unifiedStyles.u39}>
              {group.fields.map(f => (
                <div key={f.key} className={unifiedStyles.u40}>
                  <label className={unifiedStyles.u41}>
                    {f.label}
                    {f.unit && <span className={unifiedStyles.u42}> ({f.unit})</span>}
                  </label>
                  {f.type === 'boolean' ? (
                    <label className={unifiedStyles.u43}>
                      <Input
                        type="checkbox"
                        checked={!!form[f.key]}
                        onChange={e => setForm({ ...form, [f.key]: e.target.checked })}
                      />
                      {form[f.key] ? '启用' : '停用'}
                    </label>
                  ) : (
                    <Input
                      type="number"
                      value={form[f.key] ?? 0}
                      onChange={e => setForm({ ...form, [f.key]: parseInt(e.target.value) || 0 })}
                      className={unifiedStyles.u44}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className={unifiedStyles.u36}>
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </FormDialog>
  )
}
