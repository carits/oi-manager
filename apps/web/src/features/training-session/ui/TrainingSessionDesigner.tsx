"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, RefreshCw, RotateCcw } from "lucide-react";
import { PageFrame } from "@/components/ui/PageFrame";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { Button } from "@/components/ui/Button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/FormControls";
import { ConfirmDialog, FormDialog } from "@/components/ui/Dialogs";
import { Empty } from "@/components/ui/Empty";
import { PageLoadingFrame } from "@/components/ui/PageLoadingFrame";
import { useToast } from "@/components/ui/Toast";
import { TrainingDesignAuxiliary } from "./TrainingDesignAuxiliary";
import { TrainingStageTimeline } from "./TrainingStageTimeline";
import { TrainingProblemChain } from "./TrainingProblemChain";
import { TrainingStageGroupMatrix } from "./TrainingStageGroupMatrix";
import styles from "./TrainingEngine.module.css";
import { useUnsavedChanges } from "@/components/navigation/UnsavedChangesProvider";
import { saveBlobDownload } from "@/lib/download";
import { useAuth } from "@/features/auth";
import {
  getTrainingDesign,
  getTrainingDesignProblem,
  publishTraining,
  saveTrainingDesign,
  validateTrainingDesign,
} from "../api/trainingSessionApi";
import type { Assignment, Design, DesignProblem, Issue, Stage, TrainingGrouping } from "../model/trainingDesign";
import { createTrainingDesignDraft, moveItem, newTrainingDesignKey, normalizeAssignments, normalizeProblemOrder } from "../model/trainingDesign";
import { QuickProblemInput, type SelectedCanonicalProblem } from "@/features/problem-selection";

const newKey = newTrainingDesignKey;

type DesignRecoveryDraft = {
  version: 1;
  savedAt: string;
  sourceRevision: number;
  title: string;
  description: string;
  stages: Stage[];
  grouping?: TrainingGrouping;
};

const copyStageAsDraft = (stage: Stage): Stage => ({
  ...stage,
  id: undefined,
  clientKey: newKey(),
  name: `${stage.name}（副本）`,
  Problems: stage.Problems.map(problem => ({ ...problem, id: undefined, assignmentId: undefined, clientKey: newKey() })),
});

export function TrainingSessionDesigner({ sessionId }: { sessionId: string }) {
  const router = useRouter(),
    pathname = usePathname(),
    searchParams = useSearchParams(),
    toast = useToast();
  const { user } = useAuth();
  const [design, setDesign] = useState<Design | null>(null),
    [stages, setStages] = useState<Stage[]>([]),
    [grouping, setGrouping] = useState<TrainingGrouping | undefined>();
  const [activeStep, setActiveStep] = useState(2);
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [activeStageKey, setActiveStageKey] = useState("");
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [publishing, setPublishing] = useState(false),
    [dirty, setDirty] = useState(false);
  const { requestNavigation } = useUnsavedChanges(`training-session-design:${sessionId}`, dirty);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [draggedStage, setDraggedStage] = useState<number | null>(null),
    [draggedProblem, setDraggedProblem] = useState<number | null>(null);
  const [pendingRemovalConfirm, setPendingRemovalConfirm] = useState(false),
    [problemTarget, setProblemTarget] = useState<"current" | "multiple">("current"),
    [targetStages, setTargetStages] = useState<string[]>([]);
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false);
  const [recoveryDraftAvailable, setRecoveryDraftAvailable] = useState(false);
  const recoveryKey = useMemo(
    () => `training-design-recovery:${user?.userId || "anonymous"}:${sessionId}`,
    [sessionId, user?.userId],
  );
  const runtimePath = pathname.replace(/\/design$/, "");
  const copyRequestHandled = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const contractData = await getTrainingDesign(sessionId);
      const data = createTrainingDesignDraft(contractData);
      let loadedStages = data.stages;
      const requestedCopyId = copyRequestHandled.current ? null : searchParams.get("copyStage");
      if (requestedCopyId) copyRequestHandled.current = true;
      const source = requestedCopyId ? loadedStages.find(stage => stage.id === requestedCopyId) : undefined;
      const copied = source ? copyStageAsDraft(source) : undefined;
      if (copied) loadedStages = [...loadedStages, copied];
      setDesign(data);
      setStages(loadedStages);
      setGrouping({ groups: data.groups, memberships: data.participants.map(participant => { const group = data.groups.find(item => item.id === participant.groupId)!; return { participantId: participant.id, userId: participant.userId, groupId: participant.groupId, groupName: group?.name || '' } }) });
      setTitle(data.session.title);
      setDescription(data.session.description || "");
      setIssues(data.issues || []);
      setActiveStageKey((current) =>
        loadedStages.some((stage) => stage.clientKey === current)
          ? current
          : copied?.clientKey || loadedStages[0]?.clientKey || "",
      );
      setDirty(Boolean(copied));
      if (requestedCopyId && typeof window !== "undefined") window.history.replaceState(window.history.state, "", pathname);
      return true;
    } catch {
      toast.error("训练设计加载失败");
      return false;
    } finally {
      setLoading(false);
    }
  }, [pathname, searchParams, sessionId, toast]);
  useEffect(() => {
    void load();
  }, [load]);
  const refreshDesign = useCallback(async () => {
    await load();
  }, [load]);
  useEffect(() => {
    try {
      setRecoveryDraftAvailable(Boolean(window.localStorage.getItem(recoveryKey)));
    } catch {
      setRecoveryDraftAvailable(false);
    }
  }, [recoveryKey]);

  const activeStage =
    stages.find((stage) => stage.clientKey === activeStageKey) || null;
  const activeStageReadOnly = false;
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
      kind: "TRAINING",
      Problems: [],
    };
    replaceStages((current) => [...current, stage]);
    setActiveStageKey(stage.clientKey);
  };
  const copyStage = (stage: Stage) => {
    const copy = copyStageAsDraft(stage);
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
    try {
      return await getTrainingDesignProblem(sessionId, problemId) as DesignProblem;
    } catch {
      toast.error("题目不可用");
      return null;
    }
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
  const addResolvedProblems = async (problems: SelectedCanonicalProblem[]) => {
    const destinationKeys = (problemTarget === "current" ? (activeStage ? [activeStage.clientKey] : []) : targetStages).filter(key => {
      const stage = stages.find(item => item.clientKey === key);
      return Boolean(stage);
    });
    if (!destinationKeys.length) return toast.error("请先选择目标阶段");
    const details: DesignProblem[] = [];
    for (const problem of problems) {
      const detail = await fetchDesignProblem(problem.id);
      if (detail) details.push(detail);
    }
    if (!details.length) return;
    replaceStages((current) => current.map((stage) => destinationKeys.includes(stage.clientKey) ? {
      ...stage,
      Problems: [...stage.Problems, ...details.filter(problem => !stage.Problems.some(item => item.problemId === problem.id)).map(assignmentFromProblem)],
    } : stage));
  };
  const updateProblem = (
    clientKey: string,
    updater: (problem: Assignment) => Assignment,
  ) => {
    if (!activeStage) return;
    updateStage(activeStage.clientKey, (stage) => ({
      ...stage,
      Problems: stage.Problems.map((problem) => problem.clientKey === clientKey ? updater(problem) : problem),
    }));
  };
  const moveProblemToStage = (problem: Assignment, targetStageKey: string) => {
    if (!activeStage || activeStageReadOnly || targetStageKey === activeStage.clientKey) return;
    const target = stages.find((stage) => stage.clientKey === targetStageKey);
    if (
      !target ||
      target.Problems.some((item) => item.problemId === problem.problemId)
    )
      return toast.error("目标阶段已包含该题");
    replaceStages((current) =>
      current.map((stage) =>
        stage.clientKey === activeStage.clientKey
          ? { ...stage, Problems: normalizeProblemOrder(stage.Problems.filter((item) => item.clientKey !== problem.clientKey)) }
          : stage.clientKey === targetStageKey
            ? { ...stage, Problems: normalizeProblemOrder([...stage.Problems, problem]) }
            : stage,
      ),
    );
    setActiveStageKey(targetStageKey);
  };
  const updateToLatest = async (problem: Assignment) => {
    const detail = await fetchDesignProblem(problem.problemId);
    if (!detail) return;
    const updater = (current: Assignment) => ({ ...current, testSetRevisionId: detail.revision.id, TestSetRevision: detail.revision, latestRevision: detail.revision, subtasks: detail.subtasks, allowedSubtaskIds: current.allowedSubtaskIds.filter(id => detail.subtasks.some(subtask => subtask.id === id)) });
    updateProblem(problem.clientKey, updater);
  };

  const requestBody = (confirmDependentRemoval = false) => ({
    expectedRevision: design?.statusRevision ?? 0,
    title,
    description,
    confirmDependentRemoval,
    groups: grouping?.groups.map(group => ({ id: group.id, clientKey: group.clientKey, name: group.name, participantIds: group.participantIds })),
    stages: stages.map((stage) => ({
      id: stage.id,
      clientKey: stage.clientKey,
      name: stage.name,
      description: stage.description,
      kind: stage.kind,
      problems: stage.Problems.map((problem) => ({
        assignmentId: problem.assignmentId,
        clientKey: problem.clientKey,
        problemId: problem.problemId,
        testSetRevisionId: problem.testSetRevisionId,
        alias: problem.alias || null,
        unlockPolicy: problem.unlockPolicy || undefined,
        targetScore: problem.targetScore ?? null,
        scoreGoals: problem.scoreGoals,
        timePolicy: problem.timePolicy || undefined,
        stuckPolicy: problem.stuckPolicy || undefined,
        allowedSubtaskIds: problem.allowedSubtaskIds,
        strategyIntervalSeconds: problem.strategyIntervalSeconds ?? null,
      })),
    })),
  });
  const createRecoveryDraft = (): DesignRecoveryDraft => ({
    version: 1,
    savedAt: new Date().toISOString(),
    sourceRevision: design?.statusRevision ?? 0,
    title,
    description,
    stages,
    grouping,
  });
  const persistRecoveryDraft = () => {
    const snapshot = createRecoveryDraft();
    try {
      window.localStorage.setItem(recoveryKey, JSON.stringify(snapshot));
      setRecoveryDraftAvailable(true);
    } catch {
      toast.error("浏览器无法保存冲突副本，请先下载本地编排");
    }
    return snapshot;
  };
  const downloadRecoveryDraft = () => {
    const snapshot = persistRecoveryDraft();
    const safeTitle = (title || "training-design").replace(/[\\/:*?"<>|]/g, "-");
    saveBlobDownload(
      new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json;charset=utf-8" }),
      `${safeTitle}-本地编排-${snapshot.sourceRevision}.json`,
    );
  };
  const restoreRecoveryDraft = () => {
    try {
      const raw = window.localStorage.getItem(recoveryKey);
      if (!raw) return toast.error("没有可恢复的本地编排");
      const snapshot = JSON.parse(raw) as Partial<DesignRecoveryDraft>;
      if (snapshot.version !== 1 || !Array.isArray(snapshot.stages) || typeof snapshot.title !== "string") {
        return toast.error("本地编排副本格式无效");
      }
      setTitle(snapshot.title);
      setDescription(typeof snapshot.description === "string" ? snapshot.description : "");
      setStages(snapshot.stages as Stage[]);
      setGrouping(snapshot.grouping);
      setActiveStageKey(snapshot.stages[0]?.clientKey || "");
      setDirty(true);
      toast.success("已恢复本地编排，请检查后重新保存");
    } catch {
      toast.error("本地编排副本无法读取");
    }
  };
  const clearRecoveryDraft = () => {
    try {
      window.localStorage.removeItem(recoveryKey);
    } catch {
      // 保存结果已经由服务端确认，本地清理失败不影响训练结构。
    }
    setRecoveryDraftAvailable(false);
  };
  const reloadFromServer = async () => {
    const hadUnsavedChanges = dirty;
    if (hadUnsavedChanges) persistRecoveryDraft();
    setReloadConfirmOpen(false);
    const loaded = await load();
    if (loaded) toast.success(hadUnsavedChanges ? "已保存本地副本并载入服务器版本" : "已载入最新服务器版本");
  };
  const requestReload = () => {
    if (dirty) setReloadConfirmOpen(true);
    else void reloadFromServer();
  };

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
    if (!design) return;
    setSaving(true);
    const response = await saveTrainingDesign(
      sessionId,
      requestBody(confirmDependentRemoval),
    );
    setSaving(false);
    if (!response.ok) {
      if (response.error.code === "TRAINING_STRUCTURE_REMOVAL_REQUIRES_CONFIRMATION")
        return setPendingRemovalConfirm(true);
      if (response.error.code === "TRAINING_SESSION_STALE") {
        persistRecoveryDraft();
        toast.error("另一名管理员已修改训练；完整本地编排已保存，可下载或在载入新版本后恢复");
      } else {
        toast.error(response.error.message || "保存失败");
      }
      return;
    }
    setPendingRemovalConfirm(false);
    clearRecoveryDraft();
    toast.success("编排草稿已保存；未完成项会在发布检查中继续提示");
    await load();
  };
  const publish = async () => {
    if (!design || dirty) return toast.error("请先保存当前编排");
    if (!(await validate())) return;
    setPublishing(true);
    const response = await publishTraining(sessionId, { expectedRevision: design.statusRevision });
    setPublishing(false);
    if (!response.ok) return toast.error(response.error.message || "发布失败");
    toast.success("训练已发布；阶段开始后其配置固定，运行调整请在训练工作台完成");
    requestNavigation(runtimePath);
  };
  const flowPreview = useMemo(
    () =>
      stages
        .map(
          (stage) =>
            `${stage.name}：${stage.Problems.length ? stage.Problems.map((problem) => problem.alias || problem.Problem.problemId).join(" → ") : ["TEACHING", "REVIEW"].includes(stage.kind) ? "（可留空）" : "（待分配）"}`,
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
          title={["ENDED", "ARCHIVED"].includes(design.session.status) ? "训练已经结束" : "训练结构已固定"}
          description={["ENDED", "ARCHIVED"].includes(design.session.status) ? "已结束训练不能再编排。" : "已有阶段开始运行，结构不会再被设计器覆盖；请返回运行工作台进行课堂调整。"}
          action={
            <Button onClick={() => requestNavigation(runtimePath)}>
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
          description={design.session.status === "DRAFT" ? "可随时保存未完成草稿；只有发布时才要求全部配置通过检查。" : "已发布且尚未开始时仍可调整；任一阶段开始后，结构固定并转到运行工作台调整。"}
          breadcrumbs={[
            { label: "教练训练", href: runtimePath.replace(/\/[^/]+$/, "") },
            { label: "训练设计" },
          ]}
          actions={
            <>
              <Button variant="ghost" onClick={() => requestNavigation(runtimePath)}>返回运行工作台</Button>
              <Button
                variant="outline"
                icon={<RefreshCw size={16} />}
                onClick={requestReload}
                disabled={saving}
              >
                重新加载
              </Button>
              {recoveryDraftAvailable && <>
                <Button
                  variant="outline"
                  icon={<Download size={16} />}
                  onClick={downloadRecoveryDraft}
                >
                  下载本地副本
                </Button>
                <Button
                  variant="outline"
                  icon={<RotateCcw size={16} />}
                  onClick={restoreRecoveryDraft}
                >
                  恢复本地副本
                </Button>
              </>}
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
              {design.session.status === "DRAFT" && <Button
                onClick={() => void publish()}
                loading={publishing}
                disabled={dirty || issues.some((issue) => issue.severity === "error")}
              >发布训练</Button>}
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
          <>
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
              readOnly={activeStageReadOnly}
            />
            <section className={styles.designColumn} aria-label="按题号添加">
              <header><div><strong>按题号添加</strong><small>题目将固定当前正式评测版本</small></div></header>
              <div className={styles.designColumnBody}>
                <label className={styles.field}>
                  添加到
                  <Select value={problemTarget} onChange={event => {
                    const next = event.target.value as "current" | "multiple";
                    setProblemTarget(next);
                    if (next === "multiple" && !targetStages.length) setTargetStages(activeStage ? [activeStage.clientKey] : []);
                  }}>
                    <option value="current">当前阶段</option>
                    <option value="multiple">选择多个阶段</option>
                  </Select>
                </label>
                {problemTarget === "multiple" && <div className={styles.stack}>{stages.map(stage => <Checkbox
                  key={stage.clientKey}
                  label={stage.name}
                  description={`${stage.Problems.length} 道题`}
                  checked={targetStages.includes(stage.clientKey)}

                  onChange={event => setTargetStages(current => event.target.checked ? [...current, stage.clientKey] : current.filter(key => key !== stage.clientKey))}
                />)}</div>}
                <QuickProblemInput
                  disabled={!activeStage || activeStageReadOnly || (problemTarget === "multiple" && !targetStages.length)}
                  existingProblemIds={problemTarget === "current" ? activeStage?.Problems.map(item => item.problemId) : []}
                  onResolved={addResolvedProblems}
                />
              </div>
            </section>
          </div>
          {grouping && <TrainingStageGroupMatrix sessionId={sessionId} revision={design.statusRevision} stages={stages} grouping={grouping} stageGroups={design.stageGroups} onSaved={refreshDesign} />}
        </>)}

        {activeStep === 3 && (
          <TrainingDesignAuxiliary
            sessionId={sessionId}
            mode="roster"
            stages={stages}
            onStagesChange={replaceStages}
            grouping={grouping}
            onGroupingChange={setGrouping}
            onChanged={refreshDesign}
          />
        )}
        {activeStep === 4 && (
          <TrainingDesignAuxiliary
            sessionId={sessionId}
            mode="hints"
            stages={stages}
            onChanged={refreshDesign}
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
        <ConfirmDialog
          isOpen={reloadConfirmOpen}
          onClose={() => setReloadConfirmOpen(false)}
          onConfirm={() => void reloadFromServer()}
          title="用服务器版本替换当前编排？"
          message="当前修改尚未保存。继续后会先在此浏览器保存一份完整恢复副本，再载入服务器版本。"
          confirmText="保存副本并重新加载"
          loading={loading}
        />
      </div>
    </PageFrame>
  );
}
