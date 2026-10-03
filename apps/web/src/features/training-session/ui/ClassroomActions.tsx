'use client'

import { BookOpen, ListPlus, MessageSquare, Users, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import styles from './TrainingEngine.module.css'

export function ClassroomActions({
  running,
  busy,
  onAdjustProblems,
  onTeach,
  onAdjustGroups,
  onMessage,
  onEnd,
}: {
  running: boolean
  busy: boolean
  onAdjustProblems: () => void
  onTeach: () => void
  onAdjustGroups: () => void
  onMessage: () => void
  onEnd: () => void
}) {
  if (!running) return null
  return <section className={styles.classroomActions} aria-labelledby="classroom-actions-title">
    <div><h2 id="classroom-actions-title">我现在可以做什么</h2><p>常用课堂动作直接执行，更多控制收在下方。</p></div>
    <div className={styles.actions}>
      <Button variant="outline" icon={<ListPlus size={17} />} disabled={busy} onClick={onAdjustProblems}>调整题目</Button>
      <Button variant="outline" icon={<BookOpen size={17} />} disabled={busy} onClick={onTeach}>统一讲解</Button>
      <Button variant="outline" icon={<Users size={17} />} disabled={busy} onClick={onAdjustGroups}>分组调整</Button>
      <Button variant="outline" icon={<MessageSquare size={17} />} disabled={busy} onClick={onMessage}>发送提示</Button>
      <Button variant="danger" icon={<XCircle size={17} />} disabled={busy} onClick={onEnd}>结束训练</Button>
    </div>
  </section>
}
