'use client'

import { useEffect, useState } from 'react'
import { Bell, Building2, Edit3, GraduationCap, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import apiClient from '@/lib/apiClient'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import styles from './CampusHome.module.css'

interface School {
  id: string
  name: string
  shortName: string | null
  description: string | null
  announcement: string | null
  region: string | null
  schoolType: string | null
  schoolNature: string | null
  educationSystem: string | null
  educationSystemDetail: { primaryYears?: number; middleYears?: number; highYears?: number } | null
  informaticsEnabled: boolean
  informaticsStages: string[] | null
  informaticsContests: string[] | null
  informaticsTracks: string[] | null
  contactPerson: string | null
  contactPhone: string | null
  contactEmail: string | null
  contactMasked?: boolean
  status?: string
  principal?: { name: string; title?: string | null } | null
  _count: { teams: number; teachers: number; students: number }
}

interface HomeTabProps {
  school: School
  isPrincipal: boolean
  onAnnouncementUpdate: () => void
  onEditSchool?: () => void
}

interface SchoolStats {
  teacherCount: number
  teamCount: number
  ongoingContestCount: number
}

const systemNames: Record<string, string> = {
  '6-3-3': '六三三学制',
  '5-4-3': '五四三学制',
  '6-3': '六三学制',
  '5-4': '五四学制',
  custom: '自定义学制'
}

function educationDetail(school: School) {
  const presets: Record<string, [number, number, number]> = {
    '6-3-3': [6, 3, 3],
    '5-4-3': [5, 4, 3],
    '6-3': [6, 3, 0],
    '5-4': [5, 4, 0]
  }
  const code = school.educationSystem || '6-3-3'
  const years = code === 'custom'
    ? [school.educationSystemDetail?.primaryYears || 0, school.educationSystemDetail?.middleYears || 0, school.educationSystemDetail?.highYears || 0]
    : presets[code] || presets['6-3-3']

  return [['小学', years[0]], ['初中', years[1]], ['高中', years[2]]]
    .filter(([, value]) => value)
    .map(([stage, value]) => `${stage} ${value} 年`)
    .join(' · ')
}

function Tags({ values }: { values: string[] | null }) {
  if (!values?.length) return <span className={styles.empty}>暂未设置</span>
  return <div className={styles.tags}>{values.map(value => <span key={value} className={styles.tag}>{value}</span>)}</div>
}

export default function HomeTab({ school, isPrincipal, onAnnouncementUpdate, onEditSchool }: HomeTabProps) {
  const toast = useToast()
  const [editingAnnouncement, setEditingAnnouncement] = useState(false)
  const [announcement, setAnnouncement] = useState(school.announcement || '')
  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState<SchoolStats | null>(null)

  useEffect(() => {
    let active = true
    apiClient.get<SchoolStats>(`/api/schools/${school.id}/stats`)
      .then(result => { if (active && result.success && result.data) setStats(result.data) })
      .catch(() => undefined)
    return () => { active = false }
  }, [school.id])

  const saveAnnouncement = async () => {
    setSaving(true)
    try {
      const result = await apiClient.put(`/api/schools/${school.id}/announcement`, { announcement })
      if (!result.success) throw new Error(result.message)
      setEditingAnnouncement(false)
      onAnnouncementUpdate()
      toast.success('公告已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const details = [
    ['学校名称', school.name],
    ['学校简称', school.shortName || '未设置'],
    ['所在地区', school.region?.replaceAll('/', ' / ') || '未设置'],
    ['学校类型', school.schoolType || '未设置'],
    ['办学性质', school.schoolNature || '未设置'],
    ['学校状态', school.status === 'inactive' ? '停用' : '正常'],
    ['学制', systemNames[school.educationSystem || '6-3-3']],
    ['学制说明', educationDetail(school)]
  ]

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.identity}>
          <div className={styles.badge}>{(school.shortName || school.name).trim().slice(0, 1)}</div>
          <div>
            <h1 className={styles.title}>{school.name}</h1>
            <div className={styles.meta}>
              {school.region && <span>{school.region.replaceAll('/', ' · ')}</span>}
              <span className={styles.pill}>{[school.schoolNature, school.schoolType].filter(Boolean).join('') || '学校信息待完善'}</span>
              <span className={styles.pill}>{systemNames[school.educationSystem || '6-3-3']}</span>
            </div>
          </div>
        </div>
        {isPrincipal && onEditSchool && <Button icon={<Edit3 size={16} />} onClick={onEditSchool}>编辑校园信息</Button>}
      </section>

      <div className={styles.grid}>
        <div className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>基本信息</h2><Building2 size={18} color="var(--text-muted)" /></div>
            <div className={styles.details}>{details.map(([label, value]) => <div className={styles.detail} key={label}><span className={styles.label}>{label}</span><span className={styles.value}>{value}</span></div>)}</div>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>学校简介</h2></div>
            {school.description ? <p className={styles.text}>{school.description}</p> : <p className={styles.empty}>暂未填写学校简介</p>}
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2>学校公告</h2>
              {isPrincipal && <Button variant="secondary" size="sm" icon={<Bell size={15} />} onClick={() => setEditingAnnouncement(value => !value)}>{editingAnnouncement ? '取消' : '编辑公告'}</Button>}
            </div>
            {editingAnnouncement ? <><textarea value={announcement} onChange={event => setAnnouncement(event.target.value)} style={{ width: '100%', minHeight: 160, padding: 12, boxSizing: 'border-box' }} placeholder="请输入学校公告，支持 Markdown" /><div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><Button onClick={saveAnnouncement} disabled={saving}>{saving ? '保存中...' : '保存公告'}</Button></div></> : school.announcement ? <MarkdownRenderer content={school.announcement} /> : <p className={styles.empty}>暂无公告</p>}
          </section>
        </div>
        <div className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>信息学培养</h2><GraduationCap size={18} color="var(--text-muted)" /></div>
            {school.informaticsEnabled ? <>
              <div className={styles.stats}>
                <div className={styles.stat}><strong>{school._count.students}</strong><span>当前学生</span></div>
                <div className={styles.stat}><strong>{stats?.teacherCount ?? school._count.teachers}</strong><span>教练人数</span></div>
                <div className={styles.stat}><strong>{stats?.teamCount ?? school._count.teams}</strong><span>训练团队</span></div>
                <div className={styles.stat}><strong>{stats?.ongoingContestCount ?? 0}</strong><span>进行中比赛</span></div>
              </div>
              <div style={{ display: 'grid', gap: 14, marginTop: 18 }}>
                <div><span className={styles.label}>培养阶段</span><Tags values={school.informaticsStages} /></div>
                <div><span className={styles.label}>主要竞赛</span><Tags values={school.informaticsContests} /></div>
                <div><span className={styles.label}>培养体系</span><Tags values={school.informaticsTracks} /></div>
              </div>
            </> : <p className={styles.empty}>暂未标记为开展信息学竞赛培养</p>}
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeader}><h2>联系信息</h2><UsersRound size={18} color="var(--text-muted)" /></div>
            <div className={styles.contact}>
              <div className={styles.contactRow}><span>学校负责人</span><strong>{school.principal?.name || '未设置'}</strong></div>
              <div className={styles.contactRow}><span>联系人</span><strong>{school.contactPerson || '未设置'}</strong></div>
              <div className={styles.contactRow}><span>联系电话</span><strong>{school.contactPhone || '未设置'}</strong></div>
              <div className={styles.contactRow}><span>联系邮箱</span><strong>{school.contactEmail || '未设置'}</strong></div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
