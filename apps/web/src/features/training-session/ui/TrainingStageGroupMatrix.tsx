"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox, Select } from "@/components/ui/FormControls";
import { FormDialog } from "@/components/ui/Dialogs";
import { Section } from "@/components/ui/Section";
import { useToast } from "@/components/ui/Toast";
import { saveTrainingStageGroupMatrix } from "../api/trainingSessionApi";
import type { Stage, StageGroup, TrainingGrouping } from "../model/trainingDesign";
import styles from "./TrainingEngine.module.css";

const modeNames = { PRACTICE: "自由练习", EXAM: "模拟测试", GUIDED: "教师带练", REVIEW: "复盘讲解" } as const;

export function TrainingStageGroupMatrix({ sessionId, revision, stages, grouping, stageGroups, onSaved }: {
  sessionId: string; revision: number; stages: Stage[]; grouping?: TrainingGrouping; stageGroups: StageGroup[]; onSaved: () => Promise<void>
}) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<StageGroup[]>(stageGroups);
  const [editing, setEditing] = useState<StageGroup>();
  const [saving, setSaving] = useState(false);
  useEffect(() => setDrafts(stageGroups), [stageGroups]);
  const activeGroups = useMemo(() => grouping?.groups.filter(group => group.status !== "retired") || [], [grouping]);
  if (!grouping) return null;
  const update = (key: string, change: Partial<StageGroup>) => setDrafts(current => current.map(item => item.clientKey === key ? { ...item, ...change } : item));
  const applyModeToStage = (source: StageGroup) => setDrafts(current => current.map(item => item.stageId === source.stageId && item.status === "PENDING" ? { ...item, mode: source.mode, completionPolicy: source.completionPolicy, transitionPolicy: source.transitionPolicy } : item));
  const save = async () => {
    setSaving(true);
    const response = await saveTrainingStageGroupMatrix(sessionId, { expectedRevision: revision, stageGroups: drafts.map(item => ({ id: item.id, clientKey: item.clientKey, stageId: item.stageId, groupId: item.groupId, mode: item.mode, accessPolicy: item.accessPolicy, submissionMode: item.submissionMode, plannedDurationSeconds: item.plannedDurationSeconds, completionThreshold: item.completionThreshold, minDurationSeconds: item.minDurationSeconds, completionPolicy: item.completionPolicy || undefined, transitionPolicy: item.transitionPolicy, problemIds: item.problemIds, rules: item.rules || undefined })) });
    setSaving(false);
    if (!response.ok) return toast.error(response.error.message || "训练矩阵保存失败");
    toast.success("分组训练方案已保存");
    setEditing(undefined);
    await onSaved();
  };
  return <Section title="分组训练方案总览" description="为不同训练组设置每个阶段的题目、完成要求和推进方式。" actions={<Button onClick={() => void save()} loading={saving}>保存分组方案</Button>}>
    <div className={styles.matrixTable}>
      <div className={styles.matrixHeader}>分组</div>
      {stages.map(stage => <div className={styles.matrixHeader} key={stage.clientKey}>{stage.name}</div>)}
      {activeGroups.map(group => <div className={styles.matrixRow} key={group.clientKey}>
        <div className={styles.matrixHeader} key={group.clientKey + "-name"}>{group.name}<small>{group.participantIds.length} 人</small></div>
        {stages.map(stage => {
          const plan = drafts.find(item => item.groupId === group.id && item.stageId === stage.id);
          const locked = Boolean(plan && plan.status !== "PENDING");
          return <Button variant="ghost" className={styles.matrixCell} key={group.clientKey + stage.clientKey} disabled={!plan || locked} onClick={() => plan && !locked && setEditing(plan)}>
            <strong>{plan ? modeNames[plan.mode] : "保存阶段后生成"}</strong>
            <small>{locked ? "阶段已开始，方案只读" : `${plan?.problemIds.length || 0} 题 · ${plan?.transitionPolicy === "AUTO_ADVANCE" ? "自动推进" : "教师推进"}`}</small>
          </Button>;
        })}
      </div>)}
    </div>
    <FormDialog isOpen={Boolean(editing)} onClose={() => setEditing(undefined)} onSubmit={() => void save()} title={editing ? `${editing.groupName} × ${editing.stageName}` : "训练计划"} submitText="保存方案" loading={saving} dirty={Boolean(editing)}>
      {editing && <div className={styles.stack}>
        <label className={styles.field}>训练方式<Select value={editing.mode} onChange={event => update(editing.clientKey, { mode: event.target.value as StageGroup["mode"] })}>{Object.entries(modeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
        <label className={styles.field}>完成后<Select value={editing.transitionPolicy} onChange={event => update(editing.clientKey, { transitionPolicy: event.target.value as StageGroup["transitionPolicy"] })}><option value="WAIT_FOR_TEACHER">等待教师推进</option><option value="AUTO_ADVANCE">自动进入下一阶段</option></Select></label>
        <div className={styles.stack}><strong>本组本阶段题目</strong>{stages.find(stage => stage.id === editing.stageId)?.Problems.map(problem => <Checkbox key={problem.id || problem.clientKey} label={problem.Problem.problemId + " " + problem.Problem.title} checked={editing.problemIds.includes(problem.id || "")} onChange={event => update(editing.clientKey, { problemIds: event.target.checked ? [...editing.problemIds, problem.id!].filter(Boolean) : editing.problemIds.filter(id => id !== problem.id) })} />)}</div>
        <Button variant="secondary" onClick={() => applyModeToStage(editing)}>将方式应用到本阶段全部组</Button>
      </div>}
    </FormDialog>
  </Section>;
}
