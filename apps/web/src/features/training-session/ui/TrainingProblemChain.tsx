"use client";

import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/FormControls";
import type { Assignment, Stage } from "../model/trainingDesign";
import {
  moveItem,
  normalizeProblemOrder,
  stageModes,
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
  onUpdateToLatest: (problem: Assignment) => Promise<void>;
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
}: Props) {
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
          <>
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
                阶段模式
                <Select
                  value={activeStage.mode}
                  onChange={(event) =>
                    onUpdateStage(activeStage.clientKey, (stage) => ({
                      ...stage,
                      mode: event.target.value,
                      problemAccessMode:
                        event.target.value === "SEQUENTIAL"
                          ? "SEQUENTIAL"
                          : stage.problemAccessMode,
                    }))
                  }
                >
                  {stageModes.map(([value, label]) => (
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
                  推进
                  <Select
                    value={activeStage.advanceMode}
                    onChange={(event) =>
                      onUpdateStage(activeStage.clientKey, (stage) => ({
                        ...stage,
                        advanceMode: event.target.value,
                      }))
                    }
                  >
                    <option value="MANUAL">教练手动</option>
                    <option value="TIME">按时间</option>
                    <option value="COMPLETION">按完成度</option>
                    <option value="HYBRID">混合</option>
                  </Select>
                </label>
                {["TIME", "HYBRID"].includes(activeStage.advanceMode) && (
                  <label className={styles.field}>
                    时长（分钟）
                    <Input
                      type="number"
                      min={1}
                      value={
                        activeStage.durationSeconds
                          ? Math.round(activeStage.durationSeconds / 60)
                          : ""
                      }
                      onChange={(event) =>
                        onUpdateStage(activeStage.clientKey, (stage) => ({
                          ...stage,
                          durationSeconds: event.target.value
                            ? Number(event.target.value) * 60
                            : null,
                        }))
                      }
                    />
                  </label>
                )}
                {["COMPLETION", "HYBRID"].includes(activeStage.advanceMode) && (
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
              {activeStage.mode === "SCORE_PROGRESSIVE" && (
                <label className={styles.field}>
                  默认目标分
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={activeStage.targetScore ?? ""}
                    onChange={(event) =>
                      onUpdateStage(activeStage.clientKey, (stage) => ({
                        ...stage,
                        targetScore:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      }))
                    }
                  />
                </label>
              )}
            </div>
            {!activeStage.Problems.length ? (
              <Empty
                title="当前阶段尚未分配题目"
                description="从右侧题目池显式加入；Teaching / Review 阶段可留空。"
              />
            ) : (
              activeStage.Problems.map((problem, index) => (
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
                          Problems: normalizeProblemOrder(
                            moveItem(stage.Problems, draggedProblem, index),
                          ),
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
                            onClick={() => void onUpdateToLatest(problem)}
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
                            Problems: normalizeProblemOrder(
                              moveItem(stage.Problems, index, index - 1),
                            ),
                          }))
                        }
                      >
                        <ArrowUp size={14} />
                      </Button>
                      <Button
                        iconOnly
                        aria-label="下移题目"
                        variant="text"
                        disabled={index === activeStage.Problems.length - 1}
                        onClick={() =>
                          onUpdateStage(activeStage.clientKey, (stage) => ({
                            ...stage,
                            Problems: normalizeProblemOrder(
                              moveItem(stage.Problems, index, index + 1),
                            ),
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
                            Problems: normalizeProblemOrder(
                              stage.Problems.filter(
                                (item) => item.clientKey !== problem.clientKey,
                              ),
                            ),
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
                          onUpdateProblem(problem.clientKey, (current) => ({
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
                        onUpdateProblem(problem.clientKey, (current) => ({
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
                              onUpdateProblem(problem.clientKey, (current) => ({
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
          </>
        ) : (
          <Empty title="请先选择阶段" />
        )}
      </div>
    </section>
  );
}
