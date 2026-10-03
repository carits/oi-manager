'use client'

import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import styles from './TrainingEngine.module.css'

export function NextStepPanel({
  prepared,
  preparedKind,
  problemCount,
  legacyQueue,
  onPrepare,
}: {
  prepared?: string
  preparedKind?: string
  problemCount?: number
  legacyQueue: boolean
  onPrepare: () => void
}) {
  return <Section
    title="已准备的下一步"
    description="下一步最多保留一个安排；是否进入由老师在课堂中决定。"
    actions={!legacyQueue ? <Button variant="outline" onClick={onPrepare}>{prepared ? '修改安排' : '准备下一步'}</Button> : undefined}
  >
    {legacyQueue
      ? <div className={styles.message} role="status"><strong>旧版预设安排</strong><p>这次训练仍有多个旧安排，会按原顺序运行；收敛为一个前不能继续新增。</p></div>
      : prepared
        ? <div className={styles.timelineItem}><strong>{prepared}</strong><span>{preparedKind || '课堂安排'} · {problemCount || 0} 道题</span></div>
        : <p className={styles.muted}>暂时不用决定。观察学生情况后，再准备紧接着的一步。</p>}
  </Section>
}
