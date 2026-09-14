"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Input } from "@/components/ui/FormControls";
import type {
  ProblemSummary,
  SourceGroup,
  Stage,
} from "../model/trainingDesign";
import styles from "./TrainingEngine.module.css";

type Props = {
  stages: Stage[];
  activeStage: Stage | null;
  source: SourceGroup;
  query: string;
  page: number;
  pool: ProblemSummary[];
  total: number;
  loading: boolean;
  onSourceChange: (source: SourceGroup) => void;
  onQueryChange: (query: string) => void;
  onPageChange: (page: number) => void;
  onAdd: (problem: ProblemSummary) => void;
  onMultiAdd: (problem: ProblemSummary) => void;
};

export function TrainingProblemPool({
  stages,
  activeStage,
  source,
  query,
  page,
  pool,
  total,
  loading,
  onSourceChange,
  onQueryChange,
  onPageChange,
  onAdd,
  onMultiAdd,
}: Props) {
  const pageCount = Math.ceil(total / 20);
  return (
    <section className={styles.designColumn} aria-label="可用题目池">
      <header>
        <div>
          <strong>可用题目池</strong>
          <small>{total} 道</small>
        </div>
      </header>
      <div className={styles.poolControls}>
        <div className={styles.sourceTabs}>
          {([
            ["school", "组织题库"],
            ["carits", "Carits"],
            ["external", "其他题库"],
          ] as const).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={source === value ? "primary" : "outline"}
              onClick={() => onSourceChange(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <label className={styles.searchControl}>
          <Search size={15} />
          <Input
            value={query}
            placeholder="搜索题号或标题"
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
      </div>
      <div className={styles.designColumnBody}>
        {loading ? (
          <p className={styles.muted}>正在搜索…</p>
        ) : !pool.length ? (
          <Empty title="当前分区无可用题目" />
        ) : (
          pool.map((problem) => {
            const assigned = stages.filter((stage) =>
              stage.Problems.some((item) => item.problemId === problem.id),
            );
            return (
              <article className={styles.poolProblem} key={problem.id}>
                <div>
                  <strong>
                    {problem.platform} · {problem.problemId}
                  </strong>
                  <span>{problem.title}</span>
                  <small>
                    {assigned.length
                      ? `已在：${assigned.map((stage) => stage.name).join("、")}`
                      : "尚未分配"}
                  </small>
                </div>
                <div className={styles.actions}>
                  <Button
                    size="sm"
                    disabled={
                      !activeStage ||
                      activeStage.Problems.some(
                        (item) => item.problemId === problem.id,
                      )
                    }
                    onClick={() => onAdd(problem)}
                  >
                    加入当前阶段
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onMultiAdd(problem)}
                  >
                    加入多个阶段
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </div>
      {total > 20 && (
        <footer className={styles.pagination}>
          <Button
            size="sm"
            variant="outline"
            disabled={page === 1}
            onClick={() => onPageChange(page - 1)}
          >
            上一页
          </Button>
          <span>
            第 {page} / {pageCount} 页
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            下一页
          </Button>
        </footer>
      )}
    </section>
  );
}
