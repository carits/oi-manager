'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox, Input, Select } from '@/components/ui/FormControls'
import { listTeams } from '@/features/team'
import { getOrganizationStudentOptions } from '../api/organizationAccountApi'
import styles from './StudentPicker.module.css'

type Student = { userId: string; name: string; enrollmentYear?: number | null; user?: { username?: string } }
type Team = { id: string; name: string }
export function StudentPicker({ organizationId, teams, selectedIds, onChange }: {
  organizationId: string
  teams?: Team[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [students, setStudents] = useState<Student[]>([]), [loadedTeams, setLoadedTeams] = useState<Team[]>([])
  const [q, setQ] = useState(''), [grade, setGrade] = useState(''), [teamId, setTeamId] = useState('')
  const [page, setPage] = useState(1), [totalPages, setTotalPages] = useState(1), [total, setTotal] = useState(0)
  const [grades, setGrades] = useState<string[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const availableTeams = teams || loadedTeams

  useEffect(() => {
    if (teams) return
    let cancelled = false
    void (async () => {
      try {
        const first = await listTeams({ organizationId, page: 1, pageSize: 100 })
        if (cancelled) return
        const pages = await Promise.all(Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) => listTeams({ organizationId, page: index + 2, pageSize: 100 })))
        if (!cancelled) setLoadedTeams([...first.data, ...pages.flatMap(result => result.data)])
      } catch {
        if (!cancelled) setLoadedTeams([])
      }
    })()
    return () => { cancelled = true }
  }, [organizationId, teams])

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const response = await getOrganizationStudentOptions(organizationId, {
          page, pageSize: 20, q: q.trim() || undefined, grade: grade || undefined, teamId: teamId || undefined,
        })
        setStudents(response.data)
        setTotal(response.total)
        setTotalPages(Math.max(1, response.totalPages))
        setGrades(response.filters?.grades || [])
        setError('')
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : '学生列表加载失败')
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [grade, organizationId, page, q, teamId])

  const toggle = (userId: string, checked: boolean) => onChange(checked
    ? [...new Set([...selectedIds, userId])]
    : selectedIds.filter(id => id !== userId))

  return <section className={styles.picker} aria-label="选择学生">
    <header><div><strong>选择学生</strong><span>已选择 {selectedIds.length} 人</span></div>{selectedIds.length > 0 && <Button size="sm" variant="ghost" onClick={() => onChange([])}>清空已选</Button>}</header>
    <div className={styles.filters}>
      <Input aria-label="搜索学生" placeholder="搜索姓名或用户名" value={q} onChange={event => { setQ(event.target.value); setPage(1) }} />
      <Select aria-label="按年级筛选" value={grade} onChange={event => { setGrade(event.target.value); setPage(1) }}><option value="">全部年级</option>{grades.map(item => <option key={item} value={item}>{item}</option>)}</Select>
      <Select aria-label="按团队筛选" value={teamId} onChange={event => { setTeamId(event.target.value); setPage(1) }}><option value="">全部团队</option>{availableTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</Select>
    </div>
    {error ? <p className={styles.error} role="alert">{error}</p> : loading ? <p className={styles.state}>正在加载学生…</p> : students.length === 0 ? <p className={styles.state}>没有符合条件的学生</p> : <div className={styles.rows}>{students.map(student => <div className={styles.row} key={student.userId}><Checkbox label={student.name || student.user?.username || student.userId} checked={selected.has(student.userId)} onChange={event => toggle(student.userId, event.target.checked)} /><span>{student.user?.username || ''}</span></div>)}</div>}
    <footer><span>共 {total} 人 · 第 {page}/{totalPages} 页</span><div><Button size="sm" variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}>上一页</Button><Button size="sm" variant="secondary" disabled={page >= totalPages || loading} onClick={() => setPage(value => value + 1)}>下一页</Button></div></footer>
  </section>
}
