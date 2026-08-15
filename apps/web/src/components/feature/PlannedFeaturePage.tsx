'use client'

import { useEffect, useState } from 'react'
import { CircleDollarSign, Clock3, HandHeart, type LucideIcon } from 'lucide-react'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { apiClient } from '@/lib/apiClient'
import styles from './PlannedFeaturePage.module.css'

type PlannedFeature = 'carits' | 'contributions'

interface FeatureAvailability {
  featureStatus: 'planned'
  title: string
  message: string
  nextSteps: string[]
}

interface PlannedFeaturePageProps {
  feature: PlannedFeature
  endpoint: string
  scope: '个人' | '校园' | '平台管理'
}

const featureMeta: Record<PlannedFeature, { title: string; description: string; Icon: LucideIcon }> = {
  carits: {
    title: 'Carits币',
    description: '用于未来平台资源与组织协作的受控价值系统。',
    Icon: CircleDollarSign,
  },
  contributions: {
    title: '贡献',
    description: '用于未来记录可验证、可追溯的社区与校园贡献。',
    Icon: HandHeart,
  },
}

export function PlannedFeaturePage({ feature, endpoint, scope }: PlannedFeaturePageProps) {
  const [data, setData] = useState<FeatureAvailability | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void apiClient.get<FeatureAvailability>(endpoint).then(result => {
      if (!active) return
      if (result.success && result.data) {
        setData(result.data)
        setError('')
      } else {
        setError(result.message || '功能状态加载失败')
      }
    })
    return () => { active = false }
  }, [endpoint])

  const { title, description, Icon } = featureMeta[feature]
  const message = data?.message || '正在加载功能状态。'
  const nextSteps = data?.nextSteps || []

  return (
    <PageFrame width="form">
      <PageHeader title={title} description={description} />
      <section className={styles.panel} aria-label={title}>
        <div className={styles.icon}><Icon size={28} aria-hidden="true" /></div>
        <div className={styles.copy}>
          <div className={styles.kicker}><Clock3 size={16} aria-hidden="true" /> {scope}</div>
          <h2>{data?.title || '功能暂未开放'}</h2>
          <p>{error || message}</p>
          {!error && nextSteps.length > 0 && (
            <ul>
              {nextSteps.map(step => <li key={step}>{step}</li>)}
            </ul>
          )}
        </div>
      </section>
    </PageFrame>
  )
}
