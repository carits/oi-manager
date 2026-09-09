'use client'

import Link from 'next/link'
import { ArrowRight, BookOpenCheck, Database, Library, ServerCog, Users } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useResource } from '@/hooks/useResource'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import styles from '@/components/Dashboard.module.css'

interface GlobalStats { totalSchools: number; totalTeachers: number; totalStudents: number; activeUsers: number; disabledUsers: number; recentRegistrations: number }

export default function PlatformAdminPage() {
  const { user, sessionKey } = useAuth()
  const stats = useResource<GlobalStats>('/api/stats/global', { sessionKey, isEmpty: () => false, dedupingInterval: 30000 })

  return (
    <PageFrame>
      <PageHeader title="平台运营概览" description={`你好，${user?.username || '管理员'}。从账号、题库和评测状态进入日常工作。`} />
      <AsyncRegion state={stats.state} onRetry={stats.retry} skeletonRows={4}>
        {data => <div className={styles.metricGrid}>
          <div className={styles.metric}><p className={styles.metricLabel}>活跃用户</p><p className={styles.metricValue}>{data.activeUsers}</p><p className={styles.metricHint}>当前可用账号</p></div>
          <div className={styles.metric}><p className={styles.metricLabel}>近 30 天注册</p><p className={styles.metricValue}>{data.recentRegistrations}</p><p className={styles.metricHint}>近期新增账号</p></div>
          <div className={styles.metric}><p className={styles.metricLabel}>教师</p><p className={styles.metricValue}>{data.totalTeachers}</p><p className={styles.metricHint}>教师账号总数</p></div>
          <div className={styles.metric}><p className={styles.metricLabel}>学生</p><p className={styles.metricValue}>{data.totalStudents}</p><p className={styles.metricHint}>学生账号总数</p></div>
        </div>}
      </AsyncRegion>
      <div className={styles.dashboardGrid}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>主要工作</h2></div>
          <div className={styles.actionList}>
            <Link className={styles.actionLink} href="/platform-admin/users"><span className={styles.actionIcon}><Users size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>账号管理</span><span className={styles.actionHint}>查找账号、查看资料和维护状态</span></span><ArrowRight size={16} /></Link>
            <Link className={styles.actionLink} href="/platform-admin/problems"><span className={styles.actionIcon}><Library size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>题库管理</span><span className={styles.actionHint}>创建题目、抓取任务和备注</span></span><ArrowRight size={16} /></Link>
            <Link className={styles.actionLink} href="/platform-admin/data-market"><span className={styles.actionIcon}><Database size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>数据商品</span><span className={styles.actionHint}>发布质量认证数据、查看购买与处理质量事故</span></span><ArrowRight size={16} /></Link>
            <Link className={styles.actionLink} href="/platform-admin/submissions"><span className={styles.actionIcon}><BookOpenCheck size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>评测记录</span><span className={styles.actionHint}>检查提交与评测状态</span></span><ArrowRight size={16} /></Link>
          </div>
        </section>
        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>外部 OJ</h2></div>
          <div className={styles.actionList}>
            <Link className={styles.actionLink} href="/platform-admin/oj-accounts"><span className={styles.actionIcon}><ServerCog size={18} /></span><span className={styles.actionText}><span className={styles.actionTitle}>提交账号</span><span className={styles.actionHint}>查看外部平台账号状态</span></span><ArrowRight size={16} /></Link>
          </div>
        </section>
      </div>
    </PageFrame>
  )
}
