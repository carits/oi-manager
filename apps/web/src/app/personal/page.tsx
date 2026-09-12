'use client'

import Link from 'next/link'
import { useAuth } from '@/components/AuthProvider'
import { useResource } from '@/hooks/useResource'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import styles from './personal.module.css'

interface PersonalOverview {
  profile: { username: string; avatar?: string | null; rating: number; rank: number }
  invitations: Array<{ id: string; invitedAt: string; team: { id: string; name: string } }>
  contests: Array<{ id: number; title: string; startTime: string; endTime: string; status: string }>
  submissions: Array<{ id: number; oj: string; problemId: string; result: string; score?: number | null; createdAt: string }>
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function PersonalHomePage() {
  const { user, sessionKey } = useAuth()
  const resource = useResource<PersonalOverview>('/api/me/overview', {
    sessionKey,
    isEmpty: () => false,
    dedupingInterval: 30000,
  })

  return (
    <PageFrame>
      <PageHeader title="个人首页" description="管理你的个人比赛、团队和练习记录。" />
      <AsyncRegion state={resource.state} onRetry={resource.retry} skeletonRows={7}>
        {data => (
          <>
            <section className={styles.summary} aria-label="个人概览">
              <div className={styles.identity}><p className={styles.username}>{data.profile.username || user?.username}</p><p className={styles.identityHint}>欢迎回来</p></div>
              <div className={styles.metric}><span className={styles.metricValue}>{data.profile.rating}</span><span className={styles.metricLabel}>Rating</span></div>
              <div className={styles.metric}><span className={styles.metricValue}>{data.profile.rank}</span><span className={styles.metricLabel}>当前名次</span></div>
            </section>
            <div className={styles.grid}>
              <section className={styles.section}><div className={styles.sectionHeader}><h2>团队邀请</h2><Link href="/personal/teams">查看团队</Link></div>{data.invitations.length === 0 ? <div className={styles.empty}>没有待处理邀请</div> : <div className={styles.list}>{data.invitations.map(item => <Link className={styles.item} href="/personal/teams" key={item.id}><span className={styles.itemTitle}>{item.team.name}</span><span className={styles.itemMeta}>{formatDate(item.invitedAt)}</span></Link>)}</div>}</section>
              <section className={styles.section}><div className={styles.sectionHeader}><h2>近期比赛</h2><Link href="/personal/contests">全部比赛</Link></div>{data.contests.length === 0 ? <div className={styles.empty}>暂时没有比赛安排</div> : <div className={styles.list}>{data.contests.map(item => <Link className={styles.item} href={`/personal/contests/${item.id}`} key={item.id}><span className={styles.itemTitle}>{item.title}</span><span className={styles.itemMeta}>{formatDate(item.startTime)}</span></Link>)}</div>}</section>
              <section className={styles.section}><div className={styles.sectionHeader}><h2>最近提交</h2><Link href="/personal/submissions">全部记录</Link></div>{data.submissions.length === 0 ? <div className={styles.empty}>还没有个人提交</div> : <div className={styles.list}>{data.submissions.map(item => <Link className={styles.item} href={`/personal/submissions/${item.id}`} key={item.id}><span className={styles.itemTitle}>{item.oj} / {item.problemId}</span><span className={styles.itemMeta}>{item.result} · {formatDate(item.createdAt)}</span></Link>)}</div>}</section>
              <section className={styles.section}><div className={styles.sectionHeader}><h2>题目数据</h2><Link href="/personal/data-market">进入市场</Link></div><div className={styles.empty}>购买经过质量检查的测试数据，并管理已有授权。</div></section>
            </div>
          </>
        )}
      </AsyncRegion>
    </PageFrame>
  )
}
