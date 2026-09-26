"use client";

import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/FormControls";
import type { Assignment, Stage } from "../model/trainingDesign";
import { closeSubtaskSelection, moveItem, normalizeProblemOrder, removeSubtaskWithDependents, stageKinds, unlockLabel } from "../model/trainingDesign";
import { AssignmentPolicyEditor, UnlockEditor } from "./TrainingProblemPolicyEditors";
import styles from "./TrainingEngine.module.css";

type Props = {
  stages: Stage[]; activeStage: Stage | null; draggedProblem: number | null; onDraggedProblemChange: (index: number | null) => void
  onUpdateStage: (clientKey: string, updater: (stage: Stage) => Stage) => void
  onUpdateProblem: (clientKey: string, updater: (problem: Assignment) => Assignment) => void
  onMoveProblemToStage: (problem: Assignment, targetStageKey: string) => void
  onUpdateToLatest: (problem: Assignment) => Promise<void>; readOnly?: boolean
}

export function TrainingProblemChain({ stages, activeStage, draggedProblem, onDraggedProblemChange, onUpdateStage, onUpdateProblem, onMoveProblemToStage, onUpdateToLatest, readOnly = false }: Props) {
  const problems = activeStage?.Problems || []
  const updateProblems = (updater: (items: Assignment[]) => Assignment[]) => {
    if (activeStage) onUpdateStage(activeStage.clientKey, stage => ({ ...stage, Problems: updater(stage.Problems) }))
  }
  return <section className={styles.designColumn} aria-label="当前阶段题目链">
    <header><div><strong>题目链</strong><small>{activeStage?.name || "未选择阶段"}</small></div></header>
    <div className={styles.designColumnBody}>{activeStage ? <fieldset disabled={readOnly} aria-label="阶段定义" className={styles.definitionFieldset}>
      <div className={styles.stageSettings}>
        <label className={styles.field}>阶段名称<Input value={activeStage.name} onChange={event => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, name: event.target.value }))} /></label>
        <label className={styles.field}>这一阶段做什么？<Select value={activeStage.kind} onChange={event => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, kind: event.target.value as Stage["kind"] }))}>{stageKinds.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></label>
        <label className={styles.field}>阶段说明<Textarea rows={2} value={activeStage.description || ""} onChange={event => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, description: event.target.value }))} /></label>
        <p className={styles.muted}>分组、开放方式、提交规则、时长与推进策略统一在下方 Stage × Group 训练矩阵中配置。</p>
      </div>
      {!problems.length ? <Empty title="当前阶段尚未分配题目" description="从右侧按平台和题号加入；讲解、复盘阶段可以留空。" /> : problems.map((problem, index) => <div key={problem.clientKey}>
        {index > 0 && <div className={styles.unlockConnector}><span>↓</span><strong>{unlockLabel(problem.unlockPolicy)}</strong></div>}
        <article draggable onDragStart={() => onDraggedProblemChange(index)} onDragOver={event => event.preventDefault()} onDrop={() => { if (draggedProblem != null) updateProblems(items => normalizeProblemOrder(moveItem(items, draggedProblem, index))); onDraggedProblemChange(null) }} className={styles.problemChainCard}>
          <div className={styles.cardTitle}><GripVertical size={15} /><strong>{String.fromCharCode(65 + index)} · {problem.Problem.problemId} {problem.Problem.title}</strong></div>
          <div className={styles.actions}>
            <StatusBadge variant="neutral">已固定测试数据</StatusBadge>
            {problem.latestRevision && problem.latestRevision.id !== problem.testSetRevisionId && <Button variant="text" size="sm" onClick={() => void onUpdateToLatest(problem)}>更新到最新测试数据</Button>}
            <Button iconOnly aria-label="上移题目" variant="text" disabled={index === 0} onClick={() => updateProblems(items => normalizeProblemOrder(moveItem(items, index, index - 1)))}><ArrowUp size={14} /></Button>
            <Button iconOnly aria-label="下移题目" variant="text" disabled={index === problems.length - 1} onClick={() => updateProblems(items => normalizeProblemOrder(moveItem(items, index, index + 1)))}><ArrowDown size={14} /></Button>
            <Button iconOnly aria-label="移除题目" variant="text" onClick={() => updateProblems(items => normalizeProblemOrder(items.filter(item => item.clientKey !== problem.clientKey)))}><Trash2 size={14} /></Button>
          </div>
          <label className={styles.field}>移动到阶段<Select aria-label="移动题目到阶段" value={activeStage.clientKey} onChange={event => onMoveProblemToStage(problem, event.target.value)}>{stages.map(stage => <option value={stage.clientKey} key={stage.clientKey}>{stage.name}</option>)}</Select></label>
          {index === 0 ? <p className={styles.startProblem}>起始题，训练单元开始后直接开放</p> : <UnlockEditor value={problem.unlockPolicy || { mode: "ANY", conditions: [{ type: "AC" }] }} onChange={value => onUpdateProblem(problem.clientKey, current => ({ ...current, unlockPolicy: value }))} />}
          <AssignmentPolicyEditor assignment={problem} stage={activeStage} onChange={value => onUpdateProblem(problem.clientKey, current => ({ ...current, ...value }))} />
          {problem.subtasks.length > 0 && <fieldset className={styles.subtaskPicker}><legend>OI 子任务范围</legend>{problem.subtasks.map(subtask => <Checkbox key={subtask.id} label={`子任务 ${subtask.id} · ${subtask.score} 分`} description={subtask.dependencies?.length ? `依赖 S${subtask.dependencies.join(", S")}` : "无依赖"} checked={problem.allowedSubtaskIds.includes(subtask.id)} onChange={event => onUpdateProblem(problem.clientKey, current => ({ ...current, allowedSubtaskIds: event.target.checked ? closeSubtaskSelection(current.subtasks, [...current.allowedSubtaskIds, subtask.id]) : removeSubtaskWithDependents(current.subtasks, current.allowedSubtaskIds, subtask.id) }))} />)}</fieldset>}
        </article>
      </div>)}
    </fieldset> : <Empty title="请先选择阶段" />}</div>
  </section>
}