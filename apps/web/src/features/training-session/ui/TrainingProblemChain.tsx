'use client'

import { ArrowDown, ArrowUp, GripVertical, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Empty } from '@/components/ui/Empty'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/FormControls'
import type { Assignment, Stage } from '../model/trainingDesign'
import { closeSubtaskSelection, moveItem, normalizeProblemOrder, removeSubtaskWithDependents, stageKinds, unlockLabel } from '../model/trainingDesign'
import { AssignmentPolicyEditor, UnlockEditor } from './TrainingProblemPolicyEditors'
import styles from './TrainingEngine.module.css'

type Props = {
  stages: Stage[]
  activeStage: Stage | null
  draggedProblem: number | null
  onDraggedProblemChange: (index: number | null) => void
  onUpdateStage: (clientKey: string, updater: (stage: Stage) => Stage) => void
  onUpdateProblem: (clientKey: string, updater: (problem: Assignment) => Assignment) => void
  onMoveProblemToStage: (problem: Assignment, targetStageKey: string) => void
  onUpdateToLatest: (problem: Assignment) => Promise<void>
  readOnly?: boolean
}

export function TrainingProblemChain({
  stages,
  activeStage,
  draggedProblem,
  onDraggedProblemChange,
  onUpdateStage,
  onUpdateProblem,
  onMoveProblemToStage,
  onUpdateToLatest,
  readOnly = false,
}: Props) {
  const problems = activeStage?.Problems || []
  const updateProblems = (updater: (items: Assignment[]) => Assignment[]) => {
    if (activeStage) onUpdateStage(activeStage.clientKey, stage => ({ ...stage, Problems: updater(stage.Problems) }))
  }

  return <section className={styles.stageEditor} aria-label="当前阶段题目链">
    {activeStage ? <fieldset disabled={readOnly} aria-label="阶段定义" className={styles.definitionFieldset}>
      {readOnly && <div className={styles.readOnlyNotice}>当前阶段已经开始，定义只读。可以复制为未来阶段后继续调整。</div>}
      <div className={styles.stageSettings}>
        <label className={styles.field}>阶段名称<Input value={activeStage.name} onChange={event => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, name: event.target.value }))} /></label>
        <div className={styles.compactGrid}>
          <label className={styles.field}>阶段类型<Select value={activeStage.kind} onChange={event => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, kind: event.target.value as Stage['kind'] }))}>{stageKinds.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></label>
          <label className={styles.field}>题目数量<Input value={problems.length} readOnly /></label>
        </div>
        <label className={styles.field}>阶段说明<Textarea rows={2} value={activeStage.description || ''} onChange={event => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, description: event.target.value }))} /></label>
        <div className={styles.compactGrid}>
          <label className={styles.field}>这一阶段怎么练<Select value={activeStage.mode || 'PRACTICE'} onChange={event => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, mode: event.target.value as Stage['mode'] }))}><option value="PRACTICE">自由练习</option><option value="GUIDED">教师带练</option><option value="EXAM">模拟测试</option><option value="REVIEW">复盘讲解</option></Select></label>
          <label className={styles.field}>题目怎么开放<Select value={activeStage.accessPolicy || 'ALL_AT_ONCE'} onChange={event => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, accessPolicy: event.target.value as Stage['accessPolicy'] }))}><option value="ALL_AT_ONCE">全部开放</option><option value="SEQUENTIAL">按顺序开放</option><option value="TEACHER_CONTROLLED">由教师开放</option></Select></label>
          <label className={styles.field}>是否允许提交<Select value={activeStage.submissionMode || 'ENABLED'} onChange={event => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, submissionMode: event.target.value as Stage['submissionMode'] }))}><option value="ENABLED">允许提交</option><option value="DISABLED">禁止提交</option></Select></label>
          <label className={styles.field}>什么时候结束<Select value={activeStage.endPolicy || 'MANUAL'} onChange={event => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, endPolicy: event.target.value as Stage['endPolicy'] }))}><option value="MANUAL">教师手动结束</option><option value="TIME">到达计划时间</option><option value="COMPLETION">达到完成比例</option><option value="HYBRID">时间与完成度共同判断</option></Select></label>
          {['TIME', 'HYBRID'].includes(activeStage.endPolicy || 'MANUAL') && <label className={styles.field}>计划时长（分钟）<Input type="number" min={1} max={1440} value={Math.round((activeStage.plannedDurationSeconds || 0) / 60) || ''} onChange={event => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, plannedDurationSeconds: event.target.value ? Number(event.target.value) * 60 : null }))} /></label>}
          {['COMPLETION', 'HYBRID'].includes(activeStage.endPolicy || 'MANUAL') && <label className={styles.field}>完成比例（%）<Input type="number" min={1} max={100} value={activeStage.completionThreshold || 100} onChange={event => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, completionThreshold: Number(event.target.value) || null }))} /></label>}
        </div>
        <details className={styles.assignmentPolicy}>
          <summary>阶段高级设置</summary>
          <label className={styles.field}>最短持续时间（分钟）<Input type="number" min={0} max={1440} value={Math.round((activeStage.minDurationSeconds || 0) / 60)} onChange={event => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, minDurationSeconds: event.target.value ? Number(event.target.value) * 60 : null }))} /></label>
        </details>
      </div>

      <div className={styles.stageProblemList}>
        <div className={styles.stageProblemListHeader}>
          <div><strong>训练题目</strong><span>{problems.length} 道</span></div>
          <small>拖动或使用箭头调整顺序。</small>
        </div>
        {!problems.length ? <Empty title="当前阶段尚未分配题目" description="在下方按题号添加；讲解、复盘阶段可以留空。" /> : problems.map((problem, index) => <article
          key={problem.clientKey}
          draggable
          onDragStart={() => onDraggedProblemChange(index)}
          onDragOver={event => event.preventDefault()}
          onDrop={() => {
            if (draggedProblem != null) updateProblems(items => normalizeProblemOrder(moveItem(items, draggedProblem, index)))
            onDraggedProblemChange(null)
          }}
          className={styles.problemChainCard}
        >
          <div className={styles.problemChainSummary}>
            <GripVertical size={15} aria-hidden="true" />
            <span className={styles.problemOrder}>{index + 1}</span>
            <div>
              <strong>{problem.Problem.problemId}</strong>
              <span>{problem.Problem.title}</span>
            </div>
            <StatusBadge variant="neutral">目标：{problem.targetScore ?? 100} 分</StatusBadge>
          </div>
          <div className={styles.problemQuickActions}>
            {problem.latestRevision && problem.latestRevision.id !== problem.testSetRevisionId && <Button variant="text" size="sm" onClick={() => void onUpdateToLatest(problem)}>更新测试数据</Button>}
            <Button iconOnly aria-label="上移题目" variant="text" disabled={index === 0} onClick={() => updateProblems(items => normalizeProblemOrder(moveItem(items, index, index - 1)))}><ArrowUp size={14} /></Button>
            <Button iconOnly aria-label="下移题目" variant="text" disabled={index === problems.length - 1} onClick={() => updateProblems(items => normalizeProblemOrder(moveItem(items, index, index + 1)))}><ArrowDown size={14} /></Button>
            <Button iconOnly aria-label="移除题目" variant="text" onClick={() => updateProblems(items => normalizeProblemOrder(items.filter(item => item.clientKey !== problem.clientKey)))}><Trash2 size={14} /></Button>
          </div>
          <details className={styles.assignmentPolicy}>
            <summary>高级设置</summary>
            <div className={styles.stack}>
              <label className={styles.field}>移动到阶段<Select aria-label="移动题目到阶段" value={activeStage.clientKey} onChange={event => onMoveProblemToStage(problem, event.target.value)}>{stages.map(stage => <option value={stage.clientKey} key={stage.clientKey}>{stage.name}</option>)}</Select></label>
              <Checkbox label="必做题" description="必做题计入当前阶段完成度；选做题保留进度但不阻塞阶段完成。" checked={problem.required !== false} onChange={event => onUpdateProblem(problem.clientKey, current => ({ ...current, required: event.target.checked }))} />
              {index === 0 ? <p className={styles.startProblem}>阶段开始后直接开放</p> : <UnlockEditor value={problem.unlockPolicy || { mode: 'ANY', conditions: [{ type: 'AC' }] }} onChange={value => onUpdateProblem(problem.clientKey, current => ({ ...current, unlockPolicy: value }))} />}
              {index > 0 && <p className={styles.muted}>当前开放条件：{unlockLabel(problem.unlockPolicy)}</p>}
              <AssignmentPolicyEditor assignment={problem} stage={activeStage} onChange={value => onUpdateProblem(problem.clientKey, current => ({ ...current, ...value }))} />
              {problem.subtasks.length > 0 && <fieldset className={styles.subtaskPicker}><legend>OI 子任务范围</legend>{problem.subtasks.map(subtask => <Checkbox key={subtask.id} label={`子任务 ${subtask.id} · ${subtask.score} 分`} description={subtask.dependencies?.length ? `依赖 S${subtask.dependencies.join(', S')}` : '无依赖'} checked={problem.allowedSubtaskIds.includes(subtask.id)} onChange={event => onUpdateProblem(problem.clientKey, current => ({ ...current, allowedSubtaskIds: event.target.checked ? closeSubtaskSelection(current.subtasks, [...current.allowedSubtaskIds, subtask.id]) : removeSubtaskWithDependents(current.subtasks, current.allowedSubtaskIds, subtask.id) }))} />)}</fieldset>}
            </div>
          </details>
        </article>)}
      </div>
    </fieldset> : <Empty title="请先选择阶段" />}
  </section>
}
