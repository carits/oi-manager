"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/FormControls";
import type { Assignment, Stage } from "../model/trainingDesign";
import {
  moveItem,
  normalizeProblemOrder,
  stageKinds,
  unlockLabel,
} from "../model/trainingDesign";
import { AssignmentPolicyEditor, UnlockEditor } from "./TrainingProblemPolicyEditors";
import styles from "./TrainingEngine.module.css";

type Props = {
  stages: Stage[];
  activeStage: Stage | null;
  draggedProblem: number | null;
  onDraggedProblemChange: (index: number | null) => void;
  onUpdateStage: (clientKey: string, updater: (stage: Stage) => Stage) => void;
  onUpdateProblem: (
    clientKey: string,
    updater: (problem: Assignment) => Assignment,
  ) => void;
  onMoveProblemToStage: (problem: Assignment, targetStageKey: string) => void;
  onUpdateToLatest: (problem: Assignment, groupClientKey?: string) => Promise<void>;
  readOnly?: boolean;
};

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
  const [activeGroupKey, setActiveGroupKey] = useState("");
  useEffect(() => {
    if (!activeStage || activeStage.audienceMode !== "GROUPED") return setActiveGroupKey("");
    if (!activeStage.Groups.some(group => group.clientKey === activeGroupKey)) setActiveGroupKey(activeStage.Groups[0]?.clientKey || "");
  }, [activeGroupKey, activeStage]);
  const activeGroup = activeStage?.Groups.find(group => group.clientKey === activeGroupKey) || activeStage?.Groups[0];
  const displayedProblems = activeStage?.audienceMode === "GROUPED" ? activeGroup?.Problems || [] : activeStage?.Problems || [];
  const updateDisplayedProblems = (stage: Stage, updater: (items: Assignment[]) => Assignment[]): Stage => stage.audienceMode === "GROUPED"
    ? { ...stage, Groups: stage.Groups.map(group => group.clientKey === activeGroup?.clientKey ? { ...group, Problems: updater(group.Problems) } : group) }
    : { ...stage, Problems: updater(stage.Problems) };
  const updateDisplayedProblem = (clientKey: string, updater: (problem: Assignment) => Assignment) => {
    if (!activeStage) return;
    if (activeStage.audienceMode !== "GROUPED") return onUpdateProblem(clientKey, updater);
    onUpdateStage(activeStage.clientKey, stage => updateDisplayedProblems(stage, items => items.map(problem => problem.clientKey === clientKey ? updater(problem) : problem)));
  };
  return (
    <section className={styles.designColumn} aria-label="当前阶段题目链">
      <header>
        <div>
          <strong>题目链</strong>
          <small>{activeStage?.name || "未选择阶段"}</small>
        </div>
      </header>
      <div className={styles.designColumnBody}>
        {activeStage ? (
          <fieldset disabled={readOnly} aria-label={readOnly ? "已开始阶段，只读" : "阶段定义"} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {readOnly && <p className={styles.muted}>该 Stage 已开始，定义和题目计划永久只读；需要再次训练时请使用左侧“复制阶段”创建新的未来 Stage。</p>}
            <div className={styles.stageSettings}>
              <label className={styles.field}>
                阶段名称
                <Input
                  value={activeStage.name}
                  onChange={(event) =>
                    onUpdateStage(activeStage.clientKey, (stage) => ({
                      ...stage,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label className={styles.field}>
                这一阶段做什么？
                <Select
                  value={activeStage.kind}
                  onChange={(event) =>
                    onUpdateStage(activeStage.clientKey, (stage) => ({
                      ...stage,
                      kind: event.target.value as Stage["kind"],
                    }))
                  }
                >
                  {stageKinds.map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className={styles.field}>
                阶段说明
                <Textarea
                  rows={2}
                  value={activeStage.description || ""}
                  onChange={(event) =>
                    onUpdateStage(activeStage.clientKey, (stage) => ({
                      ...stage,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <div className={styles.compactGrid}>
                <label className={styles.field}>
                  谁参加？
                  <Select
                    value={activeStage.audienceMode}
                    onChange={(event) =>
                      onUpdateStage(activeStage.clientKey, (stage) => ({
                        ...stage,
                        audienceMode: event.target.value as Stage["audienceMode"],
                        Groups: event.target.value === "GROUPED" && !stage.Groups.length ? [{ clientKey: `group-${Date.now()}`, name: "分组 1", accessPolicy: stage.accessPolicy, submissionMode: stage.submissionMode, participantIds: [], Problems: [] }] : stage.Groups,
                      }))
                    }
                  >
                    <option value="ALL">全班统一</option>
                    <option value="GROUPED">Stage 内分组</option>
                  </Select>
                </label>
                <label className={styles.field}>
                  题目怎么开放？
                  <Select value={activeStage.accessPolicy} onChange={(event) => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, accessPolicy: event.target.value as Stage["accessPolicy"] }))}>
                    <option value="ALL_AT_ONCE">全部开放</option>
                    <option value="SEQUENTIAL">顺序开放</option>
                    <option value="TEACHER_CONTROLLED">教师控制</option>
                  </Select>
                </label>
                <label className={styles.field}>
                  什么时候结束？
                  <Select value={activeStage.endPolicy} onChange={(event) => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, endPolicy: event.target.value as Stage["endPolicy"] }))}>
                    <option value="MANUAL">教师手动</option><option value="TIME">到达时间</option><option value="COMPLETION">达到完成度</option><option value="HYBRID">时间和完成度</option>
                  </Select>
                </label>
                {["TIME", "HYBRID"].includes(activeStage.endPolicy) && (
                  <label className={styles.field}>
                    时长（分钟）
                    <Input
                      type="number"
                      min={1}
                      value={
                        activeStage.plannedDurationSeconds
                          ? Math.round(activeStage.plannedDurationSeconds / 60)
                          : ""
                      }
                      onChange={(event) =>
                        onUpdateStage(activeStage.clientKey, (stage) => ({
                          ...stage,
                          plannedDurationSeconds: event.target.value
                            ? Number(event.target.value) * 60
                            : null,
                        }))
                      }
                    />
                  </label>
                )}
                {["COMPLETION", "HYBRID"].includes(activeStage.endPolicy) && (
                  <label className={styles.field}>
                    完成比例（%）
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={activeStage.completionThreshold || ""}
                      onChange={(event) =>
                        onUpdateStage(activeStage.clientKey, (stage) => ({
                          ...stage,
                          completionThreshold: event.target.value
                            ? Number(event.target.value)
                            : null,
                        }))
                      }
                    />
                  </label>
                )}
              </div>
              {activeStage.audienceMode === "GROUPED" && <div className={styles.assignmentPolicy}>
                <strong>Stage 分组</strong>
                <p>每个 Stage 的分组、学员和题目链彼此独立；先选择要编辑的分组。</p>
                <label className={styles.field}>当前编辑分组<Select value={activeGroup?.clientKey || ""} onChange={event => setActiveGroupKey(event.target.value)}>{activeStage.Groups.map(group => <option key={group.clientKey} value={group.clientKey}>{group.name}</option>)}</Select></label>
                {activeStage.Groups.map((group, index) => <div className={styles.actions} key={group.clientKey}><label className={styles.field}>分组 {index + 1}<Input value={group.name} onChange={(event) => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, Groups: stage.Groups.map(item => item.clientKey === group.clientKey ? { ...item, name: event.target.value } : item) }))} /></label><Button iconOnly aria-label={`删除${group.name}`} variant="text" disabled={activeStage.Groups.length === 1} onClick={() => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, Groups: stage.Groups.filter(item => item.clientKey !== group.clientKey) }))}><Trash2 size={14} /></Button></div>)}
                <Button size="sm" variant="outline" onClick={() => onUpdateStage(activeStage.clientKey, stage => ({ ...stage, Groups: [...stage.Groups, { clientKey: `group-${Date.now()}`, name: `分组 ${stage.Groups.length + 1}`, accessPolicy: stage.accessPolicy, submissionMode: stage.submissionMode, participantIds: [], Problems: [] }] }))}>新增分组</Button>
              </div>}
              {activeStage.kind === "TRAINING" && (
                <label className={styles.field}>
                  默认目标分
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={activeStage.defaultTargetScore ?? ""}
                    onChange={(event) =>
                      onUpdateStage(activeStage.clientKey, (stage) => ({
                        ...stage,
                        defaultTargetScore:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      }))
                    }
                  />
                </label>
              )}
            </div>
            {!displayedProblems.length ? (
              <Empty
                title="当前阶段尚未分配题目"
                description="从右侧题目池显式加入；Teaching / Review 阶段可留空。"
              />
            ) : (
              displayedProblems.map((problem, index) => (
                <div key={problem.clientKey}>
                  {index > 0 && (
                    <div className={styles.unlockConnector}>
                      <span>↓</span>
                      <strong>{unlockLabel(problem.unlockPolicy)}</strong>
                    </div>
                  )}
                  <article
                    draggable
                    onDragStart={() => onDraggedProblemChange(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (draggedProblem != null) {
                        onUpdateStage(activeStage.clientKey, (stage) => ({
                          ...stage,
                          ...updateDisplayedProblems(stage, items => normalizeProblemOrder(moveItem(items, draggedProblem, index))),
                        }));
                      }
                      onDraggedProblemChange(null);
                    }}
                    className={styles.problemChainCard}
                  >
                    <div className={styles.cardTitle}>
                      <GripVertical size={15} />
                      <strong>
                        {String.fromCharCode(65 + index)} · {problem.Problem.problemId}{" "}
                        {problem.Problem.title}
                      </strong>
                    </div>
                    <div className={styles.actions}>
                      <StatusBadge variant="neutral">已固定测试数据</StatusBadge>
                      {problem.latestRevision &&
                        problem.latestRevision.id !== problem.testSetRevisionId && (
                          <Button
                            variant="text"
                            size="sm"
                            onClick={() => void onUpdateToLatest(problem, activeStage.audienceMode === "GROUPED" ? activeGroup?.clientKey : undefined)}
                          >
                            更新到最新测试数据
                          </Button>
                        )}
                      <Button
                        iconOnly
                        aria-label="上移题目"
                        variant="text"
                        disabled={index === 0}
                        onClick={() =>
                          onUpdateStage(activeStage.clientKey, (stage) => ({
                            ...stage,
                            ...updateDisplayedProblems(stage, items => normalizeProblemOrder(moveItem(items, index, index - 1))),
                          }))
                        }
                      >
                        <ArrowUp size={14} />
                      </Button>
                      <Button
                        iconOnly
                        aria-label="下移题目"
                        variant="text"
                        disabled={index === displayedProblems.length - 1}
                        onClick={() =>
                          onUpdateStage(activeStage.clientKey, (stage) => ({
                            ...stage,
                            ...updateDisplayedProblems(stage, items => normalizeProblemOrder(moveItem(items, index, index + 1))),
                          }))
                        }
                      >
                        <ArrowDown size={14} />
                      </Button>
                      <Button
                        iconOnly
                        aria-label="移除题目"
                        variant="text"
                        onClick={() =>
                          onUpdateStage(activeStage.clientKey, (stage) => ({
                            ...stage,
                            ...updateDisplayedProblems(stage, items => normalizeProblemOrder(
                              items.filter(
                                (item) => item.clientKey !== problem.clientKey,
                              ),
                            )),
                          }))
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                    <label className={styles.field}>
                      移动到阶段
                      <Select
                        aria-label="移动题目到阶段"
                        value={activeStage.clientKey}
                        onChange={(event) =>
                          onMoveProblemToStage(problem, event.target.value)
                        }
                      >
                        {stages.map((stage) => (
                          <option value={stage.clientKey} key={stage.clientKey}>
                            {stage.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                    {index === 0 ? (
                      <p className={styles.startProblem}>起始题，阶段开始后直接开放</p>
                    ) : (
                      <UnlockEditor
                        value={
                          problem.unlockPolicy || {
                            mode: "ANY",
                            conditions: [{ type: "AC" }],
                          }
                        }
                        onChange={(value) =>
                          updateDisplayedProblem(problem.clientKey, (current) => ({
                            ...current,
                            unlockPolicy: value,
                          }))
                        }
                      />
                    )}
                    <AssignmentPolicyEditor
                      assignment={problem}
                      stage={activeStage}
                      onChange={(value) =>
                        updateDisplayedProblem(problem.clientKey, (current) => ({
                          ...current,
                          ...value,
                        }))
                      }
                    />
                    {problem.subtasks.length > 0 && (
                      <fieldset className={styles.subtaskPicker}>
                        <legend>OI 子任务范围</legend>
                        {problem.subtasks.map((subtask) => (
                          <Checkbox
                            key={subtask.id}
                            label={`子任务 ${subtask.id} · ${subtask.score} 分`}
                            description={
                              subtask.dependencies?.length
                                ? `依赖 S${subtask.dependencies.join(", S")}`
                                : "无依赖"
                            }
                            checked={problem.allowedSubtaskIds.includes(subtask.id)}
                            onChange={(event) =>
                              updateDisplayedProblem(problem.clientKey, (current) => ({
                                ...current,
                                allowedSubtaskIds: event.target.checked
                                  ? [...current.allowedSubtaskIds, subtask.id]
                                  : current.allowedSubtaskIds.filter(
                                      (id) => id !== subtask.id,
                                    ),
                              }))
                            }
                          />
                        ))}
                      </fieldset>
                    )}
                  </article>
                </div>
              ))
            )}
          </fieldset>
        ) : (
          <Empty title="请先选择阶段" />
        )}
      </div>
    </section>
  );
}
