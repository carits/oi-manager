"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox, Select } from "@/components/ui/FormControls";
import { FormDialog } from "@/components/ui/Dialogs";
import { Section } from "@/components/ui/Section";
import { useToast } from "@/components/ui/Toast";
import { saveTrainingStageGroupMatrix } from "../api/trainingSessionApi";
import type { Stage, StageGroupPlan, TrainingGrouping } from "../model/trainingDesign";
import styles from "./TrainingEngine.module.css";

const modeNames = { PRACTICE: "自由练习", EXAM: "模拟测试", GUIDED: "教师带练", REVIEW: "复盘讲解" } as const;

export function TrainingStageGroupMatrix({ sessionId, revision, stages, grouping, plans, onSaved }: {
  sessionId: string; revision: number; stages: Stage[]; grouping?: TrainingGrouping; plans: StageGroupPlan[]; onSaved: () => Promise<void>
}) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<StageGroupPlan[]>(plans);
  const [editing, setEditing] = useState<StageGroupPlan>();
  const [saving, setSaving] = useState(false);
  useEffect(() => setDrafts(plans), [plans]);
  const activeGroups = useMemo(() => grouping?.groups.filter(group => group.status !== "retired") || [], [grouping]);
  if (!grouping) return null;
  const update = (key: string, change: Partial<StageGroupPlan>) => setDrafts(current => current.map(item => item.clientKey === key ? { ...item, ...change } : item));
  const applyModeToStage = (source: StageGroupPlan) => setDrafts(current => current.map(item => item.stageId === source.stageId ? { ...item, trainingMode: source.trainingMode, completionPolicy: source.completionPolicy, transitionPolicy: source.transitionPolicy } : item));
  const save = async () => {
    setSaving(true);
    const response = await saveTrainingStageGroupMatrix(sessionId, { expectedRevision: revision, plans: drafts.map(item => ({ id: item.id, clientKey: item.clientKey, stageId: item.stageId, groupId: item.groupId, trainingMode: item.trainingMode, completionPolicy: item.completionPolicy || undefined, transitionPolicy: item.transitionPolicy, problemIds: item.problemIds, rules: item.rules || undefined })) });
    setSaving(false);
    if (!response.ok) return toast.error(response.error.message || "训练矩阵保存失败");
    toast.success("Stage × Group 训练矩阵已保存");
    setEditing(undefined);
    await onSaved();
  };
  return <Section title="Stage × Group 训练矩阵" description="Group 决定谁，Stage 决定步骤；点击单元格配置这一组在这一步怎么训练。" actions={<Button onClick={() => void save()} loading={saving}>保存训练矩阵</Button>}>
    <div className={styles.matrixTable}>
      <div className={styles.matrixHeader}>分组</div>
      {stages.map(stage => <div className={styles.matrixHeader} key={stage.clientKey}>{stage.name}</div>)}
      {activeGroups.map(group => <div className={styles.matrixRow} key={group.clientKey}>
        <div className={styles.matrixHeader} key={group.clientKey + "-name"}>{group.name}<small>{group.participantIds.length} 人</small></div>
        {stages.map(stage => {
          const plan = drafts.find(item => item.groupId === group.id && item.stageId === stage.id);
          return <button type="button" className={styles.matrixCell} key={group.clientKey + stage.clientKey} disabled={!plan} onClick={() => plan && setEditing(plan)}>
            <strong>{plan ? modeNames[plan.trainingMode] : "保存阶段后生成"}</strong>
            <small>{plan?.problemIds.length || 0} 题 · {plan?.transitionPolicy === "AUTO_ADVANCE" ? "自动推进" : "教师推进"}</small>
          </button>;
        })}
      </div>)}
    </div>
    <FormDialog isOpen={Boolean(editing)} onClose={() => setEditing(undefined)} onSubmit={() => void save()} title={editing ? `${editing.groupName} × ${editing.stageName}` : "训练计划"} submitText="保存矩阵" loading={saving} dirty={Boolean(editing)}>
      {editing && <div className={styles.stack}>
        <label className={styles.field}>训练方式<Select value={editing.trainingMode} onChange={event => update(editing.clientKey, { trainingMode: event.target.value as StageGroupPlan["trainingMode"] })}>{Object.entries(modeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
        <label className={styles.field}>完成后<Select value={editing.transitionPolicy} onChange={event => update(editing.clientKey, { transitionPolicy: event.target.value as StageGroupPlan["transitionPolicy"] })}><option value="WAIT_FOR_TEACHER">等待教师推进</option><option value="AUTO_ADVANCE">自动进入下一阶段</option></Select></label>
        <div className={styles.stack}><strong>本组本阶段题目</strong>{stages.find(stage => stage.id === editing.stageId)?.Problems.map(problem => <Checkbox key={problem.id || problem.clientKey} label={problem.Problem.problemId + " " + problem.Problem.title} checked={editing.problemIds.includes(problem.id || "")} onChange={event => update(editing.clientKey, { problemIds: event.target.checked ? [...editing.problemIds, problem.id!].filter(Boolean) : editing.problemIds.filter(id => id !== problem.id) })} />)}</div>
        <Button variant="secondary" onClick={() => applyModeToStage(editing)}>将方式应用到本阶段全部组</Button>
      </div>}
    </FormDialog>
  </Section>;
}
