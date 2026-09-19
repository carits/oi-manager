"use client";

import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { Stage } from "../model/trainingDesign";
import { stageKinds } from "../model/trainingDesign";
import styles from "./TrainingEngine.module.css";

type Props = {
  stages: Stage[];
  activeStageKey: string;
  draggedIndex: number | null;
  onAdd: () => void;
  onSelect: (stageKey: string) => void;
  onDragStart: (index: number) => void;
  onDrop: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onCopy: (stage: Stage) => void;
  onRemove: (stage: Stage) => void;
};

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
}: Props) {
  return (
    <section className={styles.designColumn} aria-label="阶段时间线">
      <header>
        <div>
          <strong>阶段时间线</strong>
          <small>{stages.length}/30</small>
        </div>
        <Button
          size="sm"
          variant="outline"
          icon={<Plus size={14} />}
          onClick={onAdd}
        >
          新增
        </Button>
      </header>
      <div className={styles.designColumnBody}>
        {stages.map((stage, index) => (
          (() => {
          const editable = !stage.lifecycle || stage.lifecycle === "PENDING";
          const previousEditable = index > 0 && (!stages[index - 1].lifecycle || stages[index - 1].lifecycle === "PENDING");
          const nextEditable = index < stages.length - 1 && (!stages[index + 1].lifecycle || stages[index + 1].lifecycle === "PENDING");
          return (
          <article
            key={stage.clientKey}
            draggable={editable}
            onDragStart={() => editable && onDragStart(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => editable && draggedIndex != null && onDrop(index)}
            className={`${styles.stageCard} ${activeStageKey === stage.clientKey ? styles.activeDesignCard : ""}`}
            onClick={() => onSelect(stage.clientKey)}
          >
            <div className={styles.cardTitle}>
              <GripVertical size={15} />
              <strong>
                {index + 1}. {stage.name}
              </strong>
            </div>
            <small>
              {stageKinds.find((item) => item[0] === stage.kind)?.[1] || stage.kind}{" "}
              · {stage.audienceMode === "GROUPED" ? `${stage.Groups.length} 组` : `${stage.Problems.length} 题`}
              {stage.plannedDurationSeconds
                ? ` · ${Math.round(stage.plannedDurationSeconds / 60)} 分钟`
                : ""}
              {!editable ? ` · ${stage.lifecycle}（只读）` : ""}
            </small>
            <div className={styles.actions}>
              <Button
                iconOnly
                aria-label="上移阶段"
                variant="text"
                disabled={!editable || !previousEditable}
                onClick={(event) => {
                  event.stopPropagation();
                  onMove(index, index - 1);
                }}
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                iconOnly
                aria-label="下移阶段"
                variant="text"
                disabled={!editable || !nextEditable}
                onClick={(event) => {
                  event.stopPropagation();
                  onMove(index, index + 1);
                }}
              >
                <ArrowDown size={14} />
              </Button>
              <Button
                iconOnly
                aria-label="复制阶段"
                variant="text"
                onClick={(event) => {
                  event.stopPropagation();
                  onCopy(stage);
                }}
              >
                <Copy size={14} />
              </Button>
              <Button
                iconOnly
                aria-label="删除阶段"
                variant="text"
                disabled={!editable}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(stage);
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </article>
          );
          })()
        ))}
      </div>
    </section>
  );
}
