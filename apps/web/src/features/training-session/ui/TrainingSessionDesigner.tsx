"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GripVertical,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { apiClient } from "@/lib/apiClient";
import { PageFrame } from "@/components/ui/PageFrame";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Button } from "@/components/ui/Button";
import {
  Checkbox,
  Input,
  Select,
  Textarea,
} from "@/components/ui/FormControls";
import { ConfirmDialog, FormDialog } from "@/components/ui/Dialogs";
import { StatusBadge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { PageLoadingFrame } from "@/components/ui/PageLoadingFrame";
import { useToast } from "@/components/ui/Toast";
import { TrainingDesignAuxiliary } from "./TrainingDesignAuxiliary";
import styles from "./TrainingEngine.module.css";
import { useUnsavedChanges } from "@/components/navigation/UnsavedChangesProvider";
import {
  getTrainingDesign,
  saveTrainingDesign,
  validateTrainingDesign,
} from "../api/trainingSessionApi";
import type { Assignment, Design, DesignProblem, Issue, ProblemPage, ProblemSummary, SourceGroup, Stage, UnlockCondition, UnlockPolicy } from "../model/trainingDesign";
import { conditionLabels, createTrainingDesignDraft, moveItem, newTrainingDesignKey, normalizeAssignments, normalizeProblemOrder, stageModes, unlockLabel } from "../model/trainingDesign";

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
                  onClick={addStage}
                >
                  新增
                </Button>
              </header>
              <div className={styles.designColumnBody}>
                {stages.map((stage, index) => (
                  <article
                    key={stage.clientKey}
                    draggable
                    onDragStart={() => setDraggedStage(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (draggedStage != null)
                        replaceStages((current) =>
                          moveItem(current, draggedStage, index),
                        );
                      setDraggedStage(null);
                    }}
                    className={`${styles.stageCard} ${activeStageKey === stage.clientKey ? styles.activeDesignCard : ""}`}
                    onClick={() => setActiveStageKey(stage.clientKey)}
                  >
                    <div className={styles.cardTitle}>
                      <GripVertical size={15} />
                      <strong>
                        {index + 1}. {stage.name}
                      </strong>
                    </div>
                    <small>
                      {stageModes.find((item) => item[0] === stage.mode)?.[1] ||
                        stage.mode}{" "}
                      · {stage.Problems.length} 题
                      {stage.durationSeconds
                        ? ` · ${Math.round(stage.durationSeconds / 60)} 分钟`
                        : ""}
                    </small>
                    <div className={styles.actions}>
                      <Button
                        iconOnly
                        aria-label="上移阶段"
                        variant="text"
                        disabled={index === 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          replaceStages((current) =>
                            moveItem(current, index, index - 1),
                          );
                        }}
                      >
                        <ArrowUp size={14} />
                      </Button>
                      <Button
                        iconOnly
                        aria-label="下移阶段"
                        variant="text"
                        disabled={index === stages.length - 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          replaceStages((current) =>
                            moveItem(current, index, index + 1),
                          );
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
                          copyStage(stage);
                        }}
                      >
                        <Copy size={14} />
                      </Button>
                      <Button
                        iconOnly
                        aria-label="删除阶段"
                        variant="text"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeStage(stage);
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section
              className={styles.designColumn}
              aria-label="当前阶段题目链"
            >
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
                            updateStage(activeStage.clientKey, (stage) => ({
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
                            updateStage(activeStage.clientKey, (stage) => ({
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
                            updateStage(activeStage.clientKey, (stage) => ({
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
                              updateStage(activeStage.clientKey, (stage) => ({
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
                        {["TIME", "HYBRID"].includes(
                          activeStage.advanceMode,
                        ) && (
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
                                updateStage(activeStage.clientKey, (stage) => ({
                                  ...stage,
                                  durationSeconds: event.target.value
                                    ? Number(event.target.value) * 60
                                    : null,
                                }))
                              }
                            />
                          </label>
                        )}
                        {["COMPLETION", "HYBRID"].includes(
                          activeStage.advanceMode,
                        ) && (
                          <label className={styles.field}>
                            完成比例（%）
                            <Input
                              type="number"
                              min={1}
                              max={100}
                              value={activeStage.completionThreshold || ""}
                              onChange={(event) =>
                                updateStage(activeStage.clientKey, (stage) => ({
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
                              updateStage(activeStage.clientKey, (stage) => ({
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
                              <strong>
                                {unlockLabel(problem.unlockPolicy)}
                              </strong>
                            </div>
                          )}
                          <article
                            draggable
                            onDragStart={() => setDraggedProblem(index)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => {
                              if (draggedProblem != null)
                                updateStage(activeStage.clientKey, (stage) => ({
                                  ...stage,
                                  Problems: normalizeProblemOrder(
                                    moveItem(
                                      stage.Problems,
                                      draggedProblem,
                                      index,
                                    ),
                                  ),
                                }));
                              setDraggedProblem(null);
                            }}
                            className={styles.problemChainCard}
                          >
                            <div className={styles.cardTitle}>
                              <GripVertical size={15} />
                              <strong>
                                {String.fromCharCode(65 + index)} ·{" "}
                                {problem.Problem.problemId}{" "}
                                {problem.Problem.title}
                              </strong>
                            </div>
                            <div className={styles.actions}>
                              <StatusBadge variant="neutral">已固定测试数据</StatusBadge>
                              {problem.latestRevision &&
                                problem.latestRevision.id !==
                                  problem.testSetRevisionId && (
                                  <Button
                                    variant="text"
                                    size="sm"
                                    onClick={() => void updateToLatest(problem)}
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
                                  updateStage(
                                    activeStage.clientKey,
                                    (stage) => ({
                                      ...stage,
                                      Problems: normalizeProblemOrder(
                                        moveItem(
                                          stage.Problems,
                                          index,
                                          index - 1,
                                        ),
                                      ),
                                    }),
                                  )
                                }
                              >
                                <ArrowUp size={14} />
                              </Button>
                              <Button
                                iconOnly
                                aria-label="下移题目"
                                variant="text"
                                disabled={
                                  index === activeStage.Problems.length - 1
                                }
                                onClick={() =>
                                  updateStage(
                                    activeStage.clientKey,
                                    (stage) => ({
                                      ...stage,
                                      Problems: normalizeProblemOrder(
                                        moveItem(
                                          stage.Problems,
                                          index,
                                          index + 1,
                                        ),
                                      ),
                                    }),
                                  )
                                }
                              >
                                <ArrowDown size={14} />
                              </Button>
                              <Button
                                iconOnly
                                aria-label="移除题目"
                                variant="text"
                                onClick={() =>
                                  updateStage(
                                    activeStage.clientKey,
                                    (stage) => ({
                                      ...stage,
                                      Problems: normalizeProblemOrder(
                                        stage.Problems.filter(
                                          (item) =>
                                            item.clientKey !==
                                            problem.clientKey,
                                        ),
                                      ),
                                    }),
                                  )
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
                                  moveProblemToStage(
                                    problem,
                                    event.target.value,
                                  )
                                }
                              >
                                {stages.map((stage) => (
                                  <option
                                    value={stage.clientKey}
                                    key={stage.clientKey}
                                  >
                                    {stage.name}
                                  </option>
                                ))}
                              </Select>
                            </label>
                            {index === 0 ? (
                              <p className={styles.startProblem}>
                                起始题，阶段开始后直接开放
                              </p>
                            ) : (
                              <UnlockEditor
                                value={
                                  problem.unlockPolicy || {
                                    mode: "ANY",
                                    conditions: [{ type: "AC" }],
                                  }
                                }
                                onChange={(value) =>
                                  updateProblem(
                                    problem.clientKey,
                                    (current) => ({
                                      ...current,
                                      unlockPolicy: value,
                                    }),
                                  )
                                }
                              />
                            )}
                            <AssignmentPolicyEditor
                              assignment={problem}
                              stage={activeStage}
                              onChange={(value) =>
                                updateProblem(problem.clientKey, (current) => ({
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
                                    checked={problem.allowedSubtaskIds.includes(
                                      subtask.id,
                                    )}
                                    onChange={(event) =>
                                      updateProblem(
                                        problem.clientKey,
                                        (current) => ({
                                          ...current,
                                          allowedSubtaskIds: event.target
                                            .checked
                                            ? [
                                                ...current.allowedSubtaskIds,
                                                subtask.id,
                                              ]
                                            : current.allowedSubtaskIds.filter(
                                                (id) => id !== subtask.id,
                                              ),
                                        }),
                                      )
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

            <section className={styles.designColumn} aria-label="可用题目池">
              <header>
                <div>
                  <strong>可用题目池</strong>
                  <small>{poolTotal} 道</small>
                </div>
              </header>
              <div className={styles.poolControls}>
                <div className={styles.sourceTabs}>
                  <Button
                    size="sm"
                    variant={source === "school" ? "primary" : "outline"}
                    onClick={() => {
                      setSource("school");
                      setPage(1);
                    }}
                  >
                    组织题库
                  </Button>
                  <Button
                    size="sm"
                    variant={source === "carits" ? "primary" : "outline"}
                    onClick={() => {
                      setSource("carits");
                      setPage(1);
                    }}
                  >
                    Carits
                  </Button>
                  <Button
                    size="sm"
                    variant={source === "external" ? "primary" : "outline"}
                    onClick={() => {
                      setSource("external");
                      setPage(1);
                    }}
                  >
                    其他题库
                  </Button>
                </div>
                <label className={styles.searchControl}>
                  <Search size={15} />
                  <Input
                    value={query}
                    placeholder="搜索题号或标题"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(1);
                    }}
                  />
                </label>
              </div>
              <div className={styles.designColumnBody}>
                {poolLoading ? (
                  <p className={styles.muted}>正在搜索…</p>
                ) : !pool.length ? (
                  <Empty title="当前分区无可用题目" />
                ) : (
                  pool.map((problem) => {
                    const assigned = stages.filter((stage) =>
                      stage.Problems.some(
                        (item) => item.problemId === problem.id,
                      ),
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
                            onClick={() => void addProblem(problem)}
                          >
                            加入当前阶段
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void openMultiAdd(problem)}
                          >
                            加入多个阶段
                          </Button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
              {poolTotal > 20 && (
                <footer className={styles.pagination}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 1}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    上一页
                  </Button>
                  <span>
                    第 {page} / {Math.ceil(poolTotal / 20)} 页
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= Math.ceil(poolTotal / 20)}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    下一页
                  </Button>
                </footer>
              )}
            </section>
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

function AssignmentPolicyEditor({
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

function UnlockEditor({
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
