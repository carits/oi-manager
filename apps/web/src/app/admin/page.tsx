'use client'

import Link from 'next/link'
import { ArrowRight, Link2, School, ShieldCheck, UserPlus, Users } from 'lucide-react'
import { useAuth } from '@/features/auth'
import { useResource } from '@/hooks/useResource'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import styles from '@/components/Dashboard.module.css'

interface GlobalStats { totalSchools: number; totalTeachers: number; totalStudents: number; activeUsers: number; disabledUsers: number; recentRegistrations: number }

export default function AdminPage() {
  const { user, sessionKey } = useAuth()
  const stats = useResource<GlobalStats>('/api/stats/global', { sessionKey, isEmpty: () => false, dedupingInterval: 30000 })

  return (
    <PageFrame>
      <PageHeader title="平台治理概览" description={`你好，${user?.username || '管理员'}。这里展示平台级组织与账号状态。`} />
      <AsyncRegion state={stats.state} onRetry={stats.retry} skeletonRows={3}>
        {data => <div className={styles.metricGrid}>
          <div className={styles.metric}><p className={styles.metricLabel}>学校</p><p className={styles.metricValue}>{data.totalSchools}</p><p className={styles.metricHint}>已创建组织</p></div>
          <div className={styles.metric}><p className={styles.metricLabel}>教师</p><p className={styles.metricValue}>{data.totalTeachers}</p><p className={styles.metricHint}>平台教师账号</p></div>
          <div className={styles.metric}><p className={styles.metricLabel}>学生</p><p className={styles.metricValue}>{data.totalStudents}</p><p className={styles.metricHint}>平台学生账号</p></div>
          <div className={styles.metric}><p className={styles.metricLabel}>已禁用账号</p><p className={styles.metricValue}>{data.disabledUsers}</p><p className={styles.metricHint}>需要关注的账号状态</p></div>
        </div>}
      </AsyncRegion>
      <div className={styles.dashboardGrid}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>治理入口</h2></div>
          <div className={styles.actionList}>
            <Link className={styles.actionLink} href="/admin/schools"><span className={styles.actionIcon}><School size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>学校管理</span><span className={styles.actionHint}>创建学校、负责人和基础资料</span></span><ArrowRight size={16} /></Link>
            <Link className={styles.actionLink} href="/admin/users"><span className={styles.actionIcon}><Users size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>账号管理</span><span className={styles.actionHint}>查找用户并维护账号状态</span></span><ArrowRight size={16} /></Link>
            <Link className={styles.actionLink} href="/admin/users/new-platform-admin"><span className={styles.actionIcon}><UserPlus size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>新增平台管理员</span><span className={styles.actionHint}>授予平台管理能力</span></span><ArrowRight size={16} /></Link>
          </div>
        </section>
        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>安全与连接</h2></div>
          <div className={styles.actionList}>
            <Link className={styles.actionLink} href="/admin/security"><span className={styles.actionIcon}><ShieldCheck size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>账号安全</span><span className={styles.actionHint}>更新当前账号凭据</span></span><ArrowRight size={16} /></Link>
            <Link className={styles.actionLink} href="/admin/platform-bindings"><span className={styles.actionIcon}><Link2 size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>平台绑定</span><span className={styles.actionHint}>维护外部平台身份</span></span><ArrowRight size={16} /></Link>
          </div>
        </section>
      </div>
    </PageFrame>
  )
}
