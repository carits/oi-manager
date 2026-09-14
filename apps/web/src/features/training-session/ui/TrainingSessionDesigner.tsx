"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { apiClient } from "@/lib/apiClient";
import { PageFrame } from "@/components/ui/PageFrame";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Button } from "@/components/ui/Button";
import { Checkbox, Input, Textarea } from "@/components/ui/FormControls";
import { ConfirmDialog, FormDialog } from "@/components/ui/Dialogs";
import { Empty } from "@/components/ui/Empty";
import { PageLoadingFrame } from "@/components/ui/PageLoadingFrame";
import { useToast } from "@/components/ui/Toast";
import { TrainingDesignAuxiliary } from "./TrainingDesignAuxiliary";
import { TrainingProblemPool } from "./TrainingProblemPool";
import { TrainingStageTimeline } from "./TrainingStageTimeline";
import { TrainingProblemChain } from "./TrainingProblemChain";
import styles from "./TrainingEngine.module.css";
import { useUnsavedChanges } from "@/components/navigation/UnsavedChangesProvider";
import {
  getTrainingDesign,
  saveTrainingDesign,
  validateTrainingDesign,
} from "../api/trainingSessionApi";
import type { Assignment, Design, DesignProblem, Issue, ProblemPage, ProblemSummary, SourceGroup, Stage } from "../model/trainingDesign";
import { createTrainingDesignDraft, moveItem, newTrainingDesignKey, normalizeAssignments, normalizeProblemOrder } from "../model/trainingDesign";

const newKey = newTrainingDesignKey;

export function TrainingSessionDesigner({ sessionId }: { sessionId: string }) {
  const router = useRouter(),
    pathname = usePathname(),
    toast = useToast();
  const [design, setDesign] = useState<Design | null>(null),
    [stages, setStages] = useState<Stage[]>([]);
  const [activeStep, setActiveStep] = useState(2);
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [activeStageKey, setActiveStageKey] = useState("");
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [publishing, setPublishing] = useState(false),
    [dirty, setDirty] = useState(false);
  useUnsavedChanges(`training-session-design:${sessionId}`, dirty);
  const [issues, setIssues] = useState<Issue[]>([]),
    [source, setSource] = useState<SourceGroup>("carits"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [pool, setPool] = useState<ProblemSummary[]>([]),
    [poolTotal, setPoolTotal] = useState(0),
    [poolLoading, setPoolLoading] = useState(false);
  const [draggedStage, setDraggedStage] = useState<number | null>(null),
    [draggedProblem, setDraggedProblem] = useState<number | null>(null);
  const [pendingRemovalConfirm, setPendingRemovalConfirm] = useState(false),
    [multiProblem, setMultiProblem] = useState<DesignProblem | null>(null),
    [multiStages, setMultiStages] = useState<string[]>([]);
  const runtimePath = pathname.replace(/\/design$/, "");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const contractData = await getTrainingDesign(sessionId);
      const data = createTrainingDesignDraft(contractData);
      const loadedStages = data.stages;
      setDesign(data);
      setStages(loadedStages);
      setTitle(data.session.title);
      setDescription(data.session.description || "");
      setIssues(data.issues || []);
      setActiveStageKey((current) =>
        loadedStages.some((stage) => stage.clientKey === current)
          ? current
          : loadedStages[0]?.clientKey || "",
      );
      setDirty(false);
    } catch {
      toast.error("训练设计加载失败");
    } finally {
      setLoading(false);
    }
  }, [sessionId, toast]);
  useEffect(() => {
    void load();
  }, [load]);
  const loadPool = useCallback(async () => {
    if (!design) return;
    setPoolLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (query.trim()) params.set("keyword", query.trim());
    if (source === "school") params.set("library", "school");
    else {
      params.set("library", "platform");
      params.set("sourceGroup", source);
    }
    const response = await apiClient.get<ProblemPage>(
      `/api/problems?${params}`,
    );
    setPoolLoading(false);
    if (!response.success || !response.data) {
      setPool([]);
      setPoolTotal(0);
      return;
    }
    setPool(response.data.data || []);
    setPoolTotal(response.data.total || 0);
  }, [design, page, query, source]);
  useEffect(() => {
    void loadPool();
  }, [loadPool]);

  const activeStage =
    stages.find((stage) => stage.clientKey === activeStageKey) || null;
  const updateStage = (clientKey: string, updater: (stage: Stage) => Stage) => {
    setStages((current) =>
      current.map((stage) =>
        stage.clientKey === clientKey ? updater(stage) : stage,
      ),
    );
    setDirty(true);
  };
  const replaceStages = (updater: (current: Stage[]) => Stage[]) => {
    setStages(updater);
    setDirty(true);
  };
  const addStage = () => {
    const stage: Stage = {
      clientKey: newKey(),
      name: `新阶段 ${stages.length + 1}`,
      description: "",
      mode: "FREE",
      advanceMode: "MANUAL",
      problemAccessMode: "STAGE_ONLY",
      submissionMode: "ENABLED",
      Problems: [],
    };
    replaceStages((current) => [...current, stage]);
    setActiveStageKey(stage.clientKey);
  };
  const copyStage = (stage: Stage) => {
    const copy: Stage = {
      ...stage,
      id: undefined,
      clientKey: newKey(),
      name: `${stage.name}（副本）`,
      Problems: stage.Problems.map((problem) => ({
        ...problem,
        id: undefined,
        assignmentId: undefined,
        clientKey: newKey(),
      })),
    };
    replaceStages((current) => [...current, copy]);
    setActiveStageKey(copy.clientKey);
  };
  const removeStage = (stage: Stage) => {
    replaceStages((current) =>
      current.filter((item) => item.clientKey !== stage.clientKey),
    );
    if (activeStageKey === stage.clientKey)
      setActiveStageKey(
        stages.find((item) => item.clientKey !== stage.clientKey)?.clientKey ||
          "",
      );
  };

  const fetchDesignProblem = async (problemId: string) => {
    const response = await apiClient.get<DesignProblem>(
      `/api/training-sessions/${sessionId}/design-problems/${problemId}`,
    );
    if (!response.success || !response.data) {
      toast.error(response.message || "题目不可用");
      return null;
    }
    return response.data;
  };
  const assignmentFromProblem = (problem: DesignProblem): Assignment => ({
    clientKey: newKey(),
    problemId: problem.id,
    testSetRevisionId: problem.revision.id,
    allowedSubtaskIds: [],
    Problem: {
      id: problem.id,
      platform: problem.platform,
      problemId: problem.problemId,
      title: problem.title,
      difficulty: problem.difficulty,
    },
    TestSetRevision: problem.revision,
    latestRevision: problem.revision,
    subtasks: problem.subtasks,
    unlockPolicy: { mode: "ANY", conditions: [{ type: "AC" }] },
  });
  const addProblem = async (problem: ProblemSummary) => {
    if (!activeStage) return;
    if (activeStage.Problems.some((item) => item.problemId === problem.id))
      return toast.error("当前阶段已包含该题");
    const detail = await fetchDesignProblem(problem.id);
    if (!detail) return;
    updateStage(activeStage.clientKey, (stage) => ({
      ...stage,
      Problems: [...stage.Problems, assignmentFromProblem(detail)],
    }));
  };
  const openMultiAdd = async (problem: ProblemSummary) => {
    const detail = await fetchDesignProblem(problem.id);
    if (!detail) return;
    setMultiProblem(detail);
    setMultiStages(
      stages
        .filter(
          (stage) =>
            !stage.Problems.some((item) => item.problemId === problem.id),
        )
        .map((stage) => stage.clientKey),
    );
  };
  const confirmMultiAdd = () => {
    if (!multiProblem) return;
    replaceStages((current) =>
      current.map((stage) =>
        multiStages.includes(stage.clientKey) &&
        !stage.Problems.some((item) => item.problemId === multiProblem.id)
          ? {
              ...stage,
              Problems: [
                ...stage.Problems,
                assignmentFromProblem(multiProblem),
              ],
            }
          : stage,
      ),
    );
    setMultiProblem(null);
    setMultiStages([]);
  };
  const updateProblem = (
    clientKey: string,
    updater: (problem: Assignment) => Assignment,
  ) => {
    if (!activeStage) return;
    updateStage(activeStage.clientKey, (stage) => ({
      ...stage,
      Problems: stage.Problems.map((problem) =>
        problem.clientKey === clientKey ? updater(problem) : problem,
      ),
    }));
  };
  const moveProblemToStage = (problem: Assignment, targetStageKey: string) => {
    if (!activeStage || targetStageKey === activeStage.clientKey) return;
    const target = stages.find((stage) => stage.clientKey === targetStageKey);
    if (
      !target ||
      target.Problems.some((item) => item.problemId === problem.problemId)
    )
      return toast.error("目标阶段已包含该题");
    replaceStages((current) =>
      current.map((stage) =>
        stage.clientKey === activeStage.clientKey
          ? {
              ...stage,
              Problems: normalizeProblemOrder(
                stage.Problems.filter(
                  (item) => item.clientKey !== problem.clientKey,
                ),
              ),
            }
          : stage.clientKey === targetStageKey
            ? {
                ...stage,
                Problems: normalizeProblemOrder([...stage.Problems, problem]),
              }
            : stage,
      ),
    );
    setActiveStageKey(targetStageKey);
  };
  const updateToLatest = async (problem: Assignment) => {
    const detail = await fetchDesignProblem(problem.problemId);
    if (!detail) return;
    updateProblem(problem.clientKey, (current) => ({
      ...current,
      testSetRevisionId: detail.revision.id,
      TestSetRevision: detail.revision,
      latestRevision: detail.revision,
      subtasks: detail.subtasks,
      allowedSubtaskIds: current.allowedSubtaskIds.filter((id) =>
        detail.subtasks.some((subtask) => subtask.id === id),
      ),
    }));
  };

  const requestBody = (confirmDependentRemoval = false) => ({
    expectedRevision: design?.statusRevision ?? 0,
    title,
    description,
    confirmDependentRemoval,
    stages: stages.map((stage) => ({
      id: stage.id,
      clientKey: stage.clientKey,
      name: stage.name,
      description: stage.description,
      mode: stage.mode,
      durationSeconds: stage.durationSeconds || null,
      advanceMode: stage.advanceMode,
      problemAccessMode: stage.problemAccessMode,
      submissionMode: stage.submissionMode,
      targetScore: stage.targetScore ?? null,
      completionThreshold: stage.completionThreshold ?? null,
      minDurationSeconds: stage.minDurationSeconds ?? null,
      rules: stage.rules || undefined,
      problems: stage.Problems.map((problem) => ({
        assignmentId: problem.assignmentId,
        clientKey: problem.clientKey,
        problemId: problem.problemId,
        testSetRevisionId: problem.testSetRevisionId,
        alias: problem.alias || null,
        unlockPolicy: problem.unlockPolicy || undefined,
        targetScore: problem.targetScore ?? null,
        timeLimitSeconds: problem.timeLimitSeconds ?? null,
        allowedSubtaskIds: problem.allowedSubtaskIds,
        strategyIntervalSeconds: problem.strategyIntervalSeconds ?? null,
        maxContinuousWorkSeconds: problem.maxContinuousWorkSeconds ?? null,
        forceSwitchOnTimeout: Boolean(problem.forceSwitchOnTimeout),
      })),
    })),
  });
  const validate = async () => {
    const response = await validateTrainingDesign(sessionId, requestBody());
    if (!response.ok) {
      toast.error(response.error.message || "结构校验失败");
      return false;
    }
    setIssues(response.data.issues || []);
    if (!response.data.valid) {
      toast.error(
        `发现 ${response.data.issues.filter((issue) => issue.severity === "error").length} 个需修复的问题`,
      );
      return false;
    }
    return true;
  };
  const save = async (confirmDependentRemoval = false) => {
    if (!design || !(await validate())) return;
    setSaving(true);
    const response = await saveTrainingDesign(
      sessionId,
      requestBody(confirmDependentRemoval),
    );
    setSaving(false);
    if (!response.ok) {
      if (response.error.code === "TRAINING_STRUCTURE_REMOVAL_REQUIRES_CONFIRMATION")
        return setPendingRemovalConfirm(true);
      if (response.error.code === "TRAINING_SESSION_STALE")
        toast.error(
          "另一名管理员已修改训练，本地草稿已保留，请复制草稿后重新加载",
        );
      else toast.error(response.error.message || "保存失败");
      return;
    }
    setPendingRemovalConfirm(false);
    toast.success("编排已保存，题目分配 ID 和固定版本保持稳定");
    await load();
  };
  const publish = async () => {
    if (!design || dirty) return toast.error("请先保存当前编排");
    if (!(await validate())) return;
    setPublishing(true);
    const response = await apiClient.post(
      `/api/training-sessions/${sessionId}/publish`,
      { expectedRevision: design.statusRevision },
    );
    setPublishing(false);
    if (!response.success) return toast.error(response.message || "发布失败");
    toast.success("训练已发布，结构已永久冻结");
    router.push(runtimePath);
  };

  const flowPreview = useMemo(
    () =>
      stages
        .map(
          (stage) =>
            `${stage.name}：${stage.Problems.length ? stage.Problems.map((problem) => problem.alias || problem.Problem.problemId).join(" → ") : ["TEACHING", "REVIEW"].includes(stage.mode) ? "（可留空）" : "（待分配）"}`,
        )
        .join("  →  "),
    [stages],
  );
  if (loading) return <PageLoadingFrame title="正在打开训练设计器" rows={6} />;
  if (!design)
    return (
      <PageFrame>
        <Empty
          title="无法打开训练设计器"
          action={<Button onClick={() => router.back()}>返回</Button>}
        />
      </PageFrame>
    );
  if (!design.editable)
    return (
      <PageFrame>
        <Empty
          title="训练结构已冻结"
          description="只有 DRAFT 训练可以编排；如需改变顺序，请复制为新训练。"
          action={
            <Button onClick={() => router.push(runtimePath)}>
              返回运行工作台
            </Button>
          }
        />
      </PageFrame>
    );

  return (
    <PageFrame width="workbench">
      <div className={styles.stack}>
        <PageHeader
          title={`编排：${design.session.title}`}
          description="结构只能在 DRAFT 状态修改；发布后请复制为新训练再调整。"
          breadcrumbs={[
            { label: "教练训练", href: runtimePath.replace(/\/[^/]+$/, "") },
            { label: "训练设计" },
          ]}
          actions={
            <>
              <Button
                variant="outline"
                icon={<RefreshCw size={16} />}
                onClick={() => void load()}
                disabled={saving}
              >
                重新加载
              </Button>
              <Button variant="secondary" onClick={() => void validate()}>
                发布检查
              </Button>
              <Button
                onClick={() => void save()}
                loading={saving}
                disabled={!dirty}
              >
                保存编排
              </Button>
              <Button
                onClick={() => void publish()}
                loading={publishing}
                disabled={
                  dirty || issues.some((issue) => issue.severity === "error")
                }
              >
                发布训练
              </Button>
            </>
          }
        />

        <nav className={styles.designSteps} aria-label="训练设计步骤">
          {["基本信息", "阶段与顺序", "学员与分组", "提示配置", "发布检查"].map(
            (label, index) => (
              <Button
                key={label}
                variant={activeStep === index + 1 ? "primary" : "text"}
                aria-current={activeStep === index + 1 ? "step" : undefined}
                disabled={dirty && index + 1 >= 3}
                onClick={() => setActiveStep(index + 1)}
              >
                {index + 1} {label}
              </Button>
            ),
          )}
        </nav>
        <Section
          title="完整流程预览"
          description={issues.length ? `${issues.length} 个配置问题` : "训练流程已通过当前检查"}
        >
          <div className={styles.flowPreview}>
            {flowPreview || "请新增阶段"}
          </div>
          {issues.length > 0 && (
            <div className={styles.issueList}>
              {issues.map((issue) => (
                <Button
                  variant="text"
                  key={`${issue.path}-${issue.code}`}
                  onClick={() => {
                    const index = Number(issue.path.split(".")[1]);
                    if (Number.isInteger(index) && stages[index])
                      setActiveStageKey(stages[index].clientKey);
                  }}
                >
                  {issue.message}
                </Button>
              ))}
            </div>
          )}
        </Section>
        {activeStep === 1 && (
          <Section
            title="基本信息"
            description="名称和编排会一起保存；若他人刚刚修改过，系统会提示重新加载。"
          >
            <div className={styles.basicGrid}>
              <label className={styles.field}>
                训练名称
                <Input
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              <label className={styles.field}>
                训练说明
                <Textarea
                  rows={2}
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setDirty(true);
                  }}
                />
              </label>
            </div>
          </Section>
        )}

        {activeStep === 2 && (
          <div className={styles.designWorkspace}>
            <TrainingStageTimeline
              stages={stages}
              activeStageKey={activeStageKey}
              draggedIndex={draggedStage}
              onAdd={addStage}
              onSelect={setActiveStageKey}
              onDragStart={setDraggedStage}
              onDrop={(index) => {
                if (draggedStage != null)
                  replaceStages((current) =>
                    moveItem(current, draggedStage, index),
                  );
                setDraggedStage(null);
              }}
              onMove={(from, to) =>
                replaceStages((current) => moveItem(current, from, to))
              }
              onCopy={copyStage}
              onRemove={removeStage}
            />

            <TrainingProblemChain
              stages={stages}
              activeStage={activeStage}
              draggedProblem={draggedProblem}
              onDraggedProblemChange={setDraggedProblem}
              onUpdateStage={updateStage}
              onUpdateProblem={updateProblem}
              onMoveProblemToStage={moveProblemToStage}
              onUpdateToLatest={updateToLatest}
            />
            <TrainingProblemPool
              stages={stages}
              activeStage={activeStage}
              source={source}
              query={query}
              page={page}
              pool={pool}
              total={poolTotal}
              loading={poolLoading}
              onSourceChange={(nextSource) => {
                setSource(nextSource);
                setPage(1);
              }}
              onQueryChange={(nextQuery) => {
                setQuery(nextQuery);
                setPage(1);
              }}
              onPageChange={setPage}
              onAdd={(problem) => void addProblem(problem)}
              onMultiAdd={(problem) => void openMultiAdd(problem)}
            />
          </div>
        )}

        {activeStep === 3 && (
          <TrainingDesignAuxiliary
            sessionId={sessionId}
            mode="roster"
            stages={stages}
            onChanged={load}
          />
        )}
        {activeStep === 4 && (
          <TrainingDesignAuxiliary
            sessionId={sessionId}
            mode="hints"
            stages={stages}
            onChanged={load}
          />
        )}
        {activeStep === 5 && (
          <Section
            title="发布检查"
            description="发布后将固定学员看到的阶段、顺序、解锁条件和测试数据。"
          >
            <div className={styles.publishChecklist}>
              <p>
                <strong>阶段数</strong>
                <span>{stages.length}</span>
              </p>
              <p>
                <strong>题目分配</strong>
                <span>
                  {stages.reduce(
                    (sum, stage) => sum + stage.Problems.length,
                    0,
                  )}
                </span>
              </p>
              <p>
                <strong>校验问题</strong>
                <span>{issues.length}</span>
              </p>
            </div>
            <div className={styles.actions}>
              <Button variant="outline" onClick={() => void validate()}>
                重新检查
              </Button>
              <Button
                onClick={() => void publish()}
                loading={publishing}
                disabled={
                  dirty || issues.some((issue) => issue.severity === "error")
                }
              >
                确认发布并冻结
              </Button>
            </div>
          </Section>
        )}
        <ConfirmDialog
          isOpen={pendingRemovalConfirm}
          onClose={() => setPendingRemovalConfirm(false)}
          onConfirm={() => void save(true)}
          title="删除关联提示？"
          message="被移除的题目分配存在已配置提示。确认后这些提示将随分配一起删除。"
          confirmText="确认删除并保存"
          danger
          loading={saving}
        />
        <FormDialog
          isOpen={Boolean(multiProblem)}
          onClose={() => setMultiProblem(null)}
          title="加入多个阶段"
          description={
            multiProblem
              ? `${multiProblem.problemId} · ${multiProblem.title}`
              : ""
          }
          dirty={multiStages.length > 0}
          footer={
            <>
              <Button variant="secondary" onClick={() => setMultiProblem(null)}>
                取消
              </Button>
              <Button onClick={confirmMultiAdd} disabled={!multiStages.length}>
                确认分配
              </Button>
            </>
          }
        >
          <div className={styles.stack}>
            {stages.map((stage) => (
              <Checkbox
                key={stage.clientKey}
                label={stage.name}
                description={
                  stage.Problems.some(
                    (item) => item.problemId === multiProblem?.id,
                  )
                    ? "已存在，不会重复加入"
                    : `${stage.Problems.length} 道题`
                }
                disabled={stage.Problems.some(
                  (item) => item.problemId === multiProblem?.id,
                )}
                checked={multiStages.includes(stage.clientKey)}
                onChange={(event) =>
                  setMultiStages((current) =>
                    event.target.checked
                      ? [...current, stage.clientKey]
                      : current.filter((key) => key !== stage.clientKey),
                  )
                }
              />
            ))}
          </div>
        </FormDialog>
      </div>
    </PageFrame>
  );
}
