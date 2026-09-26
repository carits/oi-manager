'use client'

import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { Stage } from '../model/trainingDesign'
import { stageKinds } from '../model/trainingDesign'
import styles from './TrainingEngine.module.css'

type Props = {
  stages: Stage[]
  activeStageKey: string
  draggedIndex: number | null
  onAdd: () => void
  onSelect: (stageKey: string) => void
  onDragStart: (index: number) => void
  onDrop: (index: number) => void
  onMove: (from: number, to: number) => void
  onCopy: (stage: Stage) => void
  onRemove: (stage: Stage) => void
  isStageReadOnly: (stage: Stage) => boolean
}

export function TrainingStageTimeline({
  stages,
  activeStageKey,
  draggedIndex,
  onAdd,
  onSelect,
  onDragStart,
  onDrop,
  onMove,
  onCopy,
  onRemove,
  isStageReadOnly,
}: Props) {
  return <section className={styles.trainingFlow} aria-label="训练流程">
    <header className={styles.trainingFlowHeader}>
      <div>
        <h2>训练流程</h2>
        <p>按课堂顺序组织阶段，点击阶段继续编辑。</p>
      </div>
      <Button size="sm" variant="outline" icon={<Plus size={15} />} onClick={onAdd}>添加阶段</Button>
    </header>
    <div className={styles.trainingFlowList}>
      {stages.map((stage, index) => {
        const editable = !isStageReadOnly(stage)
        const previousEditable = editable && index > 0 && !isStageReadOnly(stages[index - 1])
        const nextEditable = editable && index < stages.length - 1 && !isStageReadOnly(stages[index + 1])
        return <div className={styles.trainingFlowItem} key={stage.clientKey}>
          <article
            draggable={editable}
            onDragStart={() => editable && onDragStart(index)}
            onDragOver={event => event.preventDefault()}
            onDrop={() => editable && draggedIndex != null && onDrop(index)}
            className={`${styles.stageCard} ${activeStageKey === stage.clientKey ? styles.activeDesignCard : ''}`}
            onClick={() => onSelect(stage.clientKey)}
          >
            <div className={styles.stageNumber}>{index + 1}</div>
            <div className={styles.stageCardContent}>
              <strong>{stage.name}</strong>
              <span>{stageKinds.find(item => item[0] === stage.kind)?.[1] || stage.kind} · {stage.Problems.length} 道题</span>
              {!editable && <small>已开始，定义只读</small>}
            </div>
            <div className={styles.stageCardActions}>
              <GripVertical size={16} aria-hidden="true" />
              <Button iconOnly aria-label="上移阶段" variant="text" disabled={!previousEditable} onClick={event => { event.stopPropagation(); onMove(index, index - 1) }}><ArrowUp size={14} /></Button>
              <Button iconOnly aria-label="下移阶段" variant="text" disabled={!nextEditable} onClick={event => { event.stopPropagation(); onMove(index, index + 1) }}><ArrowDown size={14} /></Button>
              <Button iconOnly aria-label="复制阶段" variant="text" onClick={event => { event.stopPropagation(); onCopy(stage) }}><Copy size={14} /></Button>
              <Button iconOnly aria-label="删除阶段" variant="text" disabled={!editable} onClick={event => { event.stopPropagation(); onRemove(stage) }}><Trash2 size={14} /></Button>
            </div>
          </article>
          {index < stages.length - 1 && <div className={styles.stageConnector} aria-hidden="true"><span /></div>}
        </div>
      })}
      {!stages.length && <div className={styles.trainingFlowEmpty}><p>还没有课堂阶段。</p><Button variant="outline" icon={<Plus size={15} />} onClick={onAdd}>添加第一个阶段</Button></div>}
    </div>
  </section>
}
