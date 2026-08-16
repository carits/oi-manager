'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, Edit3, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import apiClient from '@/lib/apiClient'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import styles from './CampusHome.module.css'

export interface CampusSchool {
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
  contactPerson: string | null
  contactPhone: string | null
  contactEmail: string | null
  contactMasked?: boolean
  status?: string
  principal?: { name: string; title?: string | null } | null
}

interface HomeTabProps {
  school: CampusSchool
  isPrincipal: boolean
  onAnnouncementUpdate: () => void
  onEditSchool?: () => void
  canViewWallet?: boolean
  announcementEndpoint?: string
  walletHref?: string
}

export default function HomeTab({ school, isPrincipal, onAnnouncementUpdate, onEditSchool, canViewWallet = false, announcementEndpoint, walletHref }: HomeTabProps) {
  const pathname = usePathname()
  const organizationId = pathname.match(/^\/org\/([^/]+)/)?.[1]
  const toast = useToast()
  const [editingAnnouncement, setEditingAnnouncement] = useState(false)
  const [announcement, setAnnouncement] = useState(school.announcement || '')
  const [saving, setSaving] = useState(false)

  const saveAnnouncement = async () => {
    setSaving(true)
    try {
      if (!announcementEndpoint) throw new Error('当前校园缺少规范组织接口')
      const result = await apiClient.put(announcementEndpoint, { announcement })
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

  const schoolType = [school.schoolNature, school.schoolType].filter(Boolean).join(' · ')

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.identity}>
          <div className={styles.badge}>{(school.shortName || school.name).trim().slice(0, 1)}</div>
          <div className={styles.schoolHeading}>
            <div className={styles.titleLine}>
              <h1 className={styles.title}>{school.name}</h1>
              {school.shortName && <span className={styles.shortName}>{school.shortName}</span>}
            </div>
            <div className={styles.meta}>
              <span>{school.region?.replaceAll('/', ' · ') || '地区待设置'}</span>
              <span>{schoolType || '学校类型待设置'}</span>
            </div>
          </div>
        </div>
        {isPrincipal && onEditSchool && (
          <Button icon={<Edit3 size={16} />} onClick={onEditSchool}>编辑校园信息</Button>
        )}
      </section>

      <div className={styles.content}>
        <main className={styles.mainColumn}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}><h2>学校简介</h2></div>
            {school.description
              ? <p className={styles.description}>{school.description}</p>
              : <p className={styles.empty}>暂未填写学校简介</p>}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}><Bell size={17} /><h2>学校公告</h2></div>
              {isPrincipal && (
                <Button variant="secondary" size="sm" onClick={() => setEditingAnnouncement(value => !value)}>
                  {editingAnnouncement ? '取消' : '编辑公告'}
                </Button>
              )}
            </div>
            {editingAnnouncement ? (
              <div className={styles.announcementEditor}>
                <textarea value={announcement} onChange={event => setAnnouncement(event.target.value)} placeholder="请输入学校公告，支持 Markdown" />
                <div className={styles.editorActions}><Button onClick={saveAnnouncement} disabled={saving}>{saving ? '保存中...' : '保存公告'}</Button></div>
              </div>
            ) : school.announcement ? (
              <MarkdownRenderer content={school.announcement} />
            ) : (
              <p className={styles.empty}>暂无公告</p>
            )}
          </section>
        </main>

        <aside className={styles.sideColumn}>
          <section className={styles.section}>
            <div className={styles.sectionTitle}><h2>学校状态</h2></div>
            <dl className={styles.infoList}>
              <div><dt>状态</dt><dd><span className={styles.status}>{school.status === 'inactive' ? '停用' : '正常'}</span></dd></div>
            </dl>
          </section>

          {canViewWallet && organizationId && <section className={styles.section}>
            <div className={styles.sectionTitle}><h2>组织钱包</h2></div>
            <Link href={walletHref || ('/org/' + organizationId + '/wallet')}>查看资产与消费记录</Link>
          </section>}

          <section className={styles.section}>
            <div className={styles.sectionTitle}><UsersRound size={18} /><h2>联系信息</h2></div>
            <dl className={styles.infoList}>
              <div><dt>学校负责人</dt><dd>{school.principal?.name || '未设置'}</dd></div>
              <div><dt>联系人</dt><dd>{school.contactPerson || '未设置'}</dd></div>
              <div><dt>联系电话</dt><dd>{school.contactPhone || '未设置'}</dd></div>
              <div><dt>联系邮箱</dt><dd>{school.contactEmail || '未设置'}</dd></div>
            </dl>
            {school.contactMasked && <p className={styles.privacyNote}>联系方式已按隐私规则隐藏部分内容</p>}
          </section>
        </aside>
      </div>
    </div>
  )
}
