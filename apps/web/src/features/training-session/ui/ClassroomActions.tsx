'use client'

import { Crosshair, ListPlus, StepForward, Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import styles from './TrainingEngine.module.css'

export function ClassroomActions({
  running,
  busy,
  onAdjustProblems,
  onFocusProblem,
  onAdjustGroups,
  onNext,
}: {
  running: boolean
  busy: boolean
  onAdjustProblems: () => void
  onFocusProblem: () => void
  onAdjustGroups: () => void
  onNext: () => void
}) {
  if (!running) return null
  return <section className={styles.classroomActions} aria-labelledby="classroom-actions-title">
    <div><h2 id="classroom-actions-title">课堂动作</h2><p>课堂主界面固定只保留四个高频动作。</p></div>
    <div className={styles.actions}>
      <Button variant="outline" icon={<ListPlus size={17} />} disabled={busy} onClick={onAdjustProblems}>题目调整</Button>
      <Button variant="outline" icon={<Crosshair size={17} />} disabled={busy} onClick={onFocusProblem}>聚焦题目</Button>
      <Button variant="outline" icon={<Users size={17} />} disabled={busy} onClick={onAdjustGroups}>调整分组</Button>
      <Button icon={<StepForward size={17} />} disabled={busy} onClick={onNext}>下一步</Button>
    </div>
  </section>
}
