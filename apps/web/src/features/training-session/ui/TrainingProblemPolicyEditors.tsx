"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Checkbox, Input, Select } from "@/components/ui/FormControls";
import type {
  Assignment,
  Stage,
  UnlockCondition,
  UnlockPolicy,
} from "../model/trainingDesign";
import { conditionLabels } from "../model/trainingDesign";
import styles from "./TrainingEngine.module.css";

export function AssignmentPolicyEditor({
  assignment,
  stage,
  onChange,
}: {
  assignment: Assignment;
  stage: Stage;
  onChange: (value: Partial<Assignment>) => void;
}) {
  const strategyMode = stage.mode === "FOCUS";
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
            {assignment.targetScore ?? stage.targetScore ?? "未设置"}
          </small>
        </label>
        <label className={styles.field}>
          单题训练时限（分钟）
          <Input
            type="number"
            min={1}
            value={
              assignment.timeLimitSeconds
                ? Math.round(assignment.timeLimitSeconds / 60)
                : ""
            }
            onChange={(event) =>
              onChange({
                timeLimitSeconds: event.target.value
                  ? Number(event.target.value) * 60
                  : null,
              })
            }
          />
        </label>
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
            <label className={styles.field}>
              最长连续作答（分钟）
              <Input
                type="number"
                min={1}
                value={
                  assignment.maxContinuousWorkSeconds
                    ? Math.round(assignment.maxContinuousWorkSeconds / 60)
                    : ""
                }
                onChange={(event) =>
                  onChange({
                    maxContinuousWorkSeconds: event.target.value
                      ? Number(event.target.value) * 60
                      : null,
                  })
                }
              />
            </label>
            <Checkbox
              label="超时后强制切换题目"
              checked={Boolean(assignment.forceSwitchOnTimeout)}
              onChange={(event) =>
                onChange({ forceSwitchOnTimeout: event.target.checked })
              }
            />
          </>
        )}
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
