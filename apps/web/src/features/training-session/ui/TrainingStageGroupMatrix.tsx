"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox, Select } from "@/components/ui/FormControls";
import { FormDialog } from "@/components/ui/Dialogs";
import { Section } from "@/components/ui/Section";
import { useToast } from "@/components/ui/Toast";
import { saveTrainingStageGroupMatrix } from "../api/trainingSessionApi";
import type { Stage, StagePlan, TrainingGrouping } from "../model/trainingDesign";
import styles from "./TrainingEngine.module.css";

const accessNames = {
  ALL_AT_ONCE: "全部开放",
  SEQUENTIAL: "顺序开放",
  TEACHER_CONTROLLED: "教师控制",
} as const;

export function TrainingStageGroupMatrix({ sessionId, revision, stages, grouping, stagePlans, onSaved }: {
  sessionId: string;
  revision: number;
  stages: Stage[];
  grouping?: TrainingGrouping;
  stagePlans: StagePlan[];
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<StagePlan[]>(stagePlans);
  const [editing, setEditing] = useState<StagePlan>();
  const [saving, setSaving] = useState(false);

  const activeGroups = useMemo(() => grouping?.groups.filter(group => group.status !== "retired") || [], [grouping]);
  useEffect(() => {
    const expanded = [...stagePlans];
    for (const stage of stages) {
      const fallback = expanded.find(plan => plan.stageId === stage.id && plan.isDefault);
      if (!fallback) continue;
      for (const group of activeGroups) if (group.id && !expanded.some(plan => plan.stageId === stage.id && plan.groupId === group.id)) expanded.push({ ...fallback, id: "", clientKey: "plan-" + stage.id + "-" + group.id, groupId: group.id, groupName: group.name, isDefault: false, inheritsDefault: true });
    }
    setDrafts(expanded);
  }, [activeGroups, stagePlans, stages]);
  if (!grouping) return null;

  const update = (key: string, change: Partial<StagePlan>) =>
    setDrafts(current => current.map(item => item.clientKey === key ? { ...item, ...change } : item));

  const save = async () => {
    setSaving(true);
    const response = await saveTrainingStageGroupMatrix(sessionId, {
      expectedRevision: revision,
      stagePlans: drafts.map(item => ({
        id: item.id,
        clientKey: item.clientKey,
        stageId: item.stageId,
        groupId: item.groupId || null,
        isDefault: item.isDefault,
        inheritsDefault: item.inheritsDefault,
        accessPolicy: item.accessPolicy,
        submissionMode: item.submissionMode,
        completionPolicy: item.completionPolicy || undefined,
        problemIds: item.problemIds,
        requiredProblemIds: item.requiredProblemIds,
        rules: item.rules || undefined,
      })),
    });
    setSaving(false);
    if (!response.ok) return toast.error(response.error.message || "阶段训练方案保存失败");
    toast.success("阶段训练方案已保存");
    setEditing(undefined);
    await onSaved();
  };

  const planRows = [
    { key: "default", name: "全班默认", groupId: null as string | null },
    ...activeGroups.map(group => ({ key: group.clientKey, name: group.name, groupId: group.id || null })),
  ];

  return <Section title="阶段训练方案" description="每个阶段只有一个全局时间轴；全班默认计划定义基础要求，分组计划只覆盖本组题目与开放规则。" actions={<Button onClick={() => void save()} loading={saving}>保存阶段方案</Button>}>
    <div className={styles.matrixTable}>
      <div className={styles.matrixHeader}>适用对象</div>
      {stages.map(stage => <div className={styles.matrixHeader} key={stage.clientKey}>{stage.name}</div>)}
      {planRows.map(row => <div className={styles.matrixRow} key={row.key}>
        <div className={styles.matrixHeader}>{row.name}<small>{row.groupId ? (activeGroups.find(group => group.id === row.groupId)?.participantIds.length || 0) + " 人" : "所有学员兜底"}</small></div>
        {stages.map(stage => {
          const plan = drafts.find(item => item.stageId === stage.id && (row.groupId ? item.groupId === row.groupId : item.isDefault));
          const locked = stage.lifecycle !== "PENDING";
          return <Button variant="ghost" className={styles.matrixCell} key={row.key + stage.clientKey} disabled={!plan || locked} onClick={() => plan && !locked && setEditing(plan)}>
            <strong>{plan ? accessNames[plan.accessPolicy] : "保存阶段后生成"}</strong>
            <small>{locked ? "阶段已开始，定义只读" : plan ? plan.problemIds.length + " 题 · " + plan.requiredProblemIds.length + " 必做" + (plan.isDefault ? "" : plan.inheritsDefault ? " · 继承默认" : " · 完全覆盖") : "暂无计划"}</small>
          </Button>;
        })}
      </div>)}
    </div>

    <FormDialog isOpen={Boolean(editing)} onClose={() => setEditing(undefined)} onSubmit={() => void save()} title={editing ? (editing.groupName || "全班默认") + " · " + editing.stageName : "阶段训练计划"} submitText="保存方案" loading={saving} dirty={Boolean(editing)}>
      {editing && <div className={styles.stack}>
        {!editing.isDefault && <Checkbox label="继承全班默认计划" description="本组未单独配置的题目继续使用默认计划。" checked={editing.inheritsDefault} onChange={event => update(editing.clientKey, { inheritsDefault: event.target.checked })} />}
        <label className={styles.field}>题目开放方式<Select value={editing.accessPolicy} onChange={event => update(editing.clientKey, { accessPolicy: event.target.value as StagePlan["accessPolicy"] })}>{Object.entries(accessNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
        <label className={styles.field}>是否允许提交<Select value={editing.submissionMode} onChange={event => update(editing.clientKey, { submissionMode: event.target.value as StagePlan["submissionMode"] })}><option value="ENABLED">允许提交</option><option value="DISABLED">禁止提交</option></Select></label>
        <div className={styles.stack}><strong>本计划题目</strong>{stages.find(stage => stage.id === editing.stageId)?.Problems.map(problem => {
          const problemId = problem.id || "";
          const selected = editing.problemIds.includes(problemId);
          const required = editing.requiredProblemIds.includes(problemId);
          return <div className={styles.card} key={problem.id || problem.clientKey}>
            <Checkbox label={problem.Problem.problemId + " " + problem.Problem.title} checked={selected} onChange={event => update(editing.clientKey, {
              problemIds: event.target.checked ? [...editing.problemIds, problemId].filter(Boolean) : editing.problemIds.filter(id => id !== problemId),
              requiredProblemIds: event.target.checked ? editing.requiredProblemIds : editing.requiredProblemIds.filter(id => id !== problemId),
            })} />
            {selected && <Checkbox label="必做题" checked={required} onChange={event => update(editing.clientKey, { requiredProblemIds: event.target.checked ? [...new Set([...editing.requiredProblemIds, problemId])] : editing.requiredProblemIds.filter(id => id !== problemId) })} />}
          </div>;
        })}</div>
      </div>}
    </FormDialog>
  </Section>;
}
