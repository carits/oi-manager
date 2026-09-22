"use client";

import { useEffect, useState } from "react";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/FormControls";
import type {
  Assignment,
  ProblemTimeAction,
  Stage,
  UnlockCondition,
  UnlockPolicy,
} from "../model/trainingDesign";
import { conditionLabels } from "../model/trainingDesign";
import styles from "./TrainingEngine.module.css";

function ScoreGoalsEditor({ assignment, onChange }: { assignment: Assignment; onChange: (value: Partial<Assignment>) => void }) {
  const serialized = (assignment.scoreGoals || []).map(item => item.score).join(",")
  const [draft, setDraft] = useState(serialized)
  useEffect(() => setDraft(serialized), [serialized])
  const commit = () => {
    const scores = [...new Set(draft.split(/[，,\s]+/).map(Number).filter(value => Number.isInteger(value) && value > 0 && value <= 100))].sort((a, b) => a - b)
    onChange({ scoreGoals: scores.map(score => ({ score })) })
    setDraft(scores.join(","))
  }
  return <label className={styles.field}>
    递进目标分
    <Input
      aria-label="递进目标分"
      value={draft}
      placeholder="例如 30,60,100"
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit() } }}
    />
    <small>{assignment.scoreGoals?.length ? `目标路径：${assignment.scoreGoals.map(item => item.score).join(" → ")}` : "留空表示只使用单一目标分 / AC"}</small>
    <div className={styles.actions}>
      <Button size="sm" variant="text" onClick={() => { setDraft("30,60,100"); onChange({ scoreGoals: [{ score: 30 }, { score: 60 }, { score: 100 }] }) }}>30 → 60 → 100</Button>
      <Button size="sm" variant="text" onClick={() => { setDraft(""); onChange({ scoreGoals: [] }) }}>清除递进</Button>
    </div>
  </label>
}

const canonicalTimeMode = (mode: string): ProblemTimeAction | "NONE" => {
  if (mode === "SOFT") return "REMIND"
  if (mode === "HARD") return "LOCK_SUBMISSION"
  if (mode === "SWITCH_REQUIRED") return "FORCE_SWITCH"
  return (["REMIND", "RECOMMEND_SWITCH", "LOCK_SUBMISSION", "FORCE_SWITCH"].includes(mode) ? mode : "NONE") as ProblemTimeAction | "NONE"
}

export function AssignmentPolicyEditor({
  assignment,
  stage,
  onChange,
}: {
  assignment: Assignment;
  stage: Stage;
  onChange: (value: Partial<Assignment>) => void;
}) {
  const strategyMode = stage.accessPolicy === "TEACHER_CONTROLLED";
  return (
    <details className={styles.assignmentPolicy}>
      <summary>单题目标与训练策略</summary>
      <div className={styles.compactGrid}>
        <label className={styles.field}>
          目标分（留空继承阶段）
          <Input
            type="number"
            min={0}
            max={100}
            value={assignment.targetScore ?? ""}
            onChange={(event) =>
              onChange({
                targetScore:
                  event.target.value === "" ? null : Number(event.target.value),
              })
            }
          />
          <small>
            当前有效目标：
            {assignment.targetScore ?? stage.defaultTargetScore ?? "未设置"}
          </small>
        </label>
        <ScoreGoalsEditor assignment={assignment} onChange={onChange} />
        <label className={styles.field}>
          单题时间动作
          <Select value={canonicalTimeMode(assignment.timePolicy?.mode || "NONE")} onChange={(event) => {
            const mode = event.target.value as ProblemTimeAction | "NONE"
            onChange({ timePolicy: mode === "NONE" ? { mode: "NONE" } : { mode, action: mode, limitSeconds: assignment.timePolicy && "limitSeconds" in assignment.timePolicy ? assignment.timePolicy.limitSeconds : 900 } })
          }}>
            <option value="NONE">不限时</option>
            <option value="REMIND">到时提醒</option>
            <option value="RECOMMEND_SWITCH">建议切题</option>
            <option value="LOCK_SUBMISSION">禁止继续提交</option>
            <option value="FORCE_SWITCH">必须切题</option>
          </Select>
        </label>
        {assignment.timePolicy?.mode !== "NONE" && assignment.timePolicy?.mode && <label className={styles.field}>
          时间限制（分钟）
          <Input type="number" min={1} max={1440} value={Math.round(assignment.timePolicy.limitSeconds / 60)} onChange={(event) => {
            const mode = canonicalTimeMode(assignment.timePolicy!.mode)
            if (mode !== "NONE") onChange({ timePolicy: { mode, action: mode, limitSeconds: Math.max(60, Number(event.target.value || 1) * 60) } })
          }} />
        </label>}
        {strategyMode && (
          <>
            <label className={styles.field}>
              策略切换间隔（分钟）
              <Input
                type="number"
                min={1}
                value={
                  assignment.strategyIntervalSeconds
                    ? Math.round(assignment.strategyIntervalSeconds / 60)
                    : ""
                }
                onChange={(event) =>
                  onChange({
                    strategyIntervalSeconds: event.target.value
                      ? Number(event.target.value) * 60
                      : null,
                  })
                }
              />
            </label>
          </>
        )}
        <label className={styles.field}>卡题判定：最少活跃（分钟）<Input type="number" min={1} value={Math.round((assignment.stuckPolicy?.minActiveSeconds || 1800) / 60)} onChange={(event) => onChange({ stuckPolicy: { minActiveSeconds: Math.max(60, Number(event.target.value || 1) * 60), minAttempts: assignment.stuckPolicy?.minAttempts || 3, noImprovementSeconds: assignment.stuckPolicy?.noImprovementSeconds || 900 } })} /></label>
        <label className={styles.field}>卡题判定：最少提交<Input type="number" min={1} value={assignment.stuckPolicy?.minAttempts || 3} onChange={(event) => onChange({ stuckPolicy: { minActiveSeconds: assignment.stuckPolicy?.minActiveSeconds || 1800, minAttempts: Math.max(1, Number(event.target.value || 1)), noImprovementSeconds: assignment.stuckPolicy?.noImprovementSeconds || 900 } })} /></label>
        <label className={styles.field}>卡题判定：无提升（分钟）<Input type="number" min={1} value={Math.round((assignment.stuckPolicy?.noImprovementSeconds || 900) / 60)} onChange={(event) => onChange({ stuckPolicy: { minActiveSeconds: assignment.stuckPolicy?.minActiveSeconds || 1800, minAttempts: assignment.stuckPolicy?.minAttempts || 3, noImprovementSeconds: Math.max(60, Number(event.target.value || 1) * 60) } })} /></label>
      </div>
    </details>
  );
}

export function UnlockEditor({
  value,
  onChange,
}: {
  value: UnlockPolicy;
  onChange: (value: UnlockPolicy) => void;
}) {
  const conditions = value.conditions?.length
    ? value.conditions
    : [{ type: "AC" as const }];
  return (
    <div className={styles.unlockEditor}>
      <div className={styles.unlockHeader}>
        <strong>前一道题解锁条件</strong>
        <Select
          aria-label="条件组合"
          value={value.mode}
          onChange={(event) =>
            onChange({ ...value, mode: event.target.value as "ANY" | "ALL" })
          }
        >
          <option value="ANY">任意一项 ANY</option>
          <option value="ALL">全部满足 ALL</option>
        </Select>
      </div>
      {conditions.map((condition, index) => (
        <div className={styles.conditionRow} key={`${condition.type}-${index}`}>
          <Select
            value={condition.type}
            aria-label={`解锁条件 ${index + 1}`}
            onChange={(event) => {
              const type = event.target.value as UnlockCondition["type"];
              onChange({
                ...value,
                conditions: conditions.map((item, current) =>
                  current === index
                    ? {
                        type,
                        ...(["AC", "TEACHER"].includes(type)
                          ? {}
                          : { value: type === "SCORE" ? 60 : 1 }),
                      }
                    : item,
                ),
              });
            }}
          >
            {Object.entries(conditionLabels).map(([type, label]) => (
              <option value={type} key={type}>
                {label}
              </option>
            ))}
          </Select>
          {!["AC", "TEACHER"].includes(condition.type) && (
            <Input
              aria-label="条件值"
              type="number"
              min={condition.type === "SCORE" ? 0 : 1}
              max={
                condition.type === "SCORE"
                  ? 100
                  : condition.type === "ATTEMPTS"
                    ? 1000
                    : 604800
              }
              value={condition.value || ""}
              onChange={(event) =>
                onChange({
                  ...value,
                  conditions: conditions.map((item, current) =>
                    current === index
                      ? { ...item, value: Number(event.target.value) }
                      : item,
                  ),
                })
              }
            />
          )}
          <Button
            iconOnly
            aria-label="删除解锁条件"
            variant="text"
            disabled={conditions.length === 1}
            onClick={() =>
              onChange({
                ...value,
                conditions: conditions.filter(
                  (_, current) => current !== index,
                ),
              })
            }
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        icon={<Plus size={14} />}
        disabled={conditions.length >= 10}
        onClick={() =>
          onChange({ ...value, conditions: [...conditions, { type: "AC" }] })
        }
      >
        添加条件
      </Button>
    </div>
  );
}
