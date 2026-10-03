"use client";
import { publicErrorMessage } from '@/lib/humanErrors'

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Eye, Lightbulb, RefreshCw, RotateCcw, Send, Settings2, Users } from "lucide-react";
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
import { TrainingStageDrawer } from "./TrainingStageDrawer";
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
import { createTrainingDesignDraft, isTrainingStageDefinitionLocked, moveItem, newTrainingDesignKey, normalizeAssignments, normalizeProblemOrder } from "../model/trainingDesign";
import { ProblemReferenceSelector, type AddProblemReferences } from "@/features/problem-selection";

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
  const { sessionKey } = useAuth();
  return <TrainingSessionDesignEditor key={JSON.stringify([sessionKey, sessionId])} sessionId={sessionId} />;
}

function TrainingSessionDesignEditor({ sessionId }: { sessionId: string }) {
  const router = useRouter(),
    pathname = usePathname(),
    searchParams = useSearchParams(),
    toast = useToast();
  const { user } = useAuth();
  const [design, setDesign] = useState<Design | null>(null),
    [stages, setStages] = useState<Stage[]>([]),
    [grouping, setGrouping] = useState<TrainingGrouping | undefined>();
  const stagesRef = useRef(stages);
  stagesRef.current = stages;
  const [stageDrawerOpen, setStageDrawerOpen] = useState(false);
  const [auxiliaryPanel, setAuxiliaryPanel] = useState<"roster" | "hints" | "matrix" | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [activeStageKey, setActiveStageKey] = useState("");
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [publishing, setPublishing] = useState(false),
    [dirty, setDirty] = useState(false),
    [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving" | "error" | "conflict">("saved");
  const { requestNavigation } = useUnsavedChanges(
    `training-session-design:${sessionId}`,
    dirty,
    JSON.stringify({ title, description, stages, grouping }),
  );
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
  const changeVersionRef = useRef(0);
  const statusRevisionRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const saveRef = useRef<(confirmDependentRemoval?: boolean, quiet?: boolean) => Promise<boolean>>(async () => false);
  const markDirty = useCallback(() => {
    changeVersionRef.current += 1;
    setDirty(true);
    setSaveStatus("dirty");
  }, []);

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
      statusRevisionRef.current = data.statusRevision;
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
      changeVersionRef.current = copied ? 1 : 0;
      setDirty(Boolean(copied));
      setSaveStatus(copied ? "dirty" : "saved");
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
  const stageReadOnly = (stage: Stage | null | undefined) =>
    isTrainingStageDefinitionLocked(stage?.id, stages);
  const activeStageReadOnly = stageReadOnly(activeStage);
  const updateStage = (clientKey: string, updater: (stage: Stage) => Stage) => {
    const target = stages.find((stage) => stage.clientKey === clientKey);
    if (stageReadOnly(target)) {
      toast.error("该阶段已经开始，定义不可修改");
      return;
    }
    setStages((current) =>
      current.map((stage) =>
        stage.clientKey === clientKey ? updater(stage) : stage,
      ),
    );
    markDirty();
  };
  const replaceStages = (updater: (current: Stage[]) => Stage[]) => {
    setStages(updater);
    markDirty();
  };
  const addStage = () => {
    const stage: Stage = {
      clientKey: newKey(),
      name: `新阶段 ${stages.length + 1}`,
      description: "",
      kind: "TRAINING",
      lifecycle: "PENDING",
      mode: "PRACTICE",
      accessPolicy: "ALL_AT_ONCE",
      submissionMode: "ENABLED",
      endPolicy: "MANUAL",
      plannedDurationSeconds: null,
      minDurationSeconds: null,
      completionThreshold: null,
      completionPolicy: null,
      rules: null,
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
    if (stageReadOnly(stage)) return toast.error("该阶段已经开始，不能删除");
    replaceStages((current) =>
      current.filter((item) => item.clientKey !== stage.clientKey),
    );
    if (activeStageKey === stage.clientKey)
      setActiveStageKey(
        stages.find((item) => item.clientKey !== stage.clientKey)?.clientKey ||
          "",
      );
  };

  const assignmentFromProblem = (problem: DesignProblem, alias?: string | null): Assignment => ({
    clientKey: newKey(),
    problemId: problem.id,
    alias: alias || null,
    allowedSubtaskIds: [],
    Problem: {
      id: problem.id,
      platform: problem.platform,
      problemId: problem.problemId,
      title: problem.title,
      difficulty: problem.difficulty,
    },
    currentData: problem.data,
    subtasks: problem.subtasks,
    unlockPolicy: { mode: "ANY", conditions: [{ type: "AC" }] },
  });
  const selectedDestinationKeys = problemTarget === "current" ? (activeStage ? [activeStage.clientKey] : []) : targetStages;
  const destinations = stages.filter(stage => selectedDestinationKeys.includes(stage.clientKey));
  // A number is a duplicate only when every selected destination already contains it.
  const destinationProblemIds = destinations[0]?.Problems.filter(problem => destinations.every(stage => stage.Problems.some(item => item.problemId === problem.problemId))).map(problem => problem.problemId) || [];
  const addResolvedProblems: AddProblemReferences = async (references, operation) => {
    const destinationKeys = [...selectedDestinationKeys];
    if (!destinationKeys.length) throw new Error("请选择尚未开始的目标阶段");
    const details: Array<{ problem: DesignProblem; alias?: string | null }> = [];
    const rejected: Array<{ id: string; message: string }> = [];
    for (const reference of references) {
      const problem = reference.problem;
      if (!operation.isCurrent()) return { acceptedIds: [], rejected };
      try {
        const detail = await getTrainingDesignProblem(sessionId, problem.id) as DesignProblem;
        if (detail.id !== problem.id) throw new Error("题目详情与检索身份不一致");
        details.push({ problem: detail, alias: reference.alias });
      } catch (error) {
        rejected.push({ id: problem.id, message: publicErrorMessage(error, "训练题目详情加载失败，请重试") });
      }
    }
    if (!operation.isCurrent()) return { acceptedIds: [], rejected };
    const currentStages = stagesRef.current;
    if (destinationKeys.some(key => {
      const stage = currentStages.find(item => item.clientKey === key);
      return !stage || isTrainingStageDefinitionLocked(stage.id, currentStages);
    })) throw new Error("目标阶段已变化或开始运行，题号已保留，请重新选择");
    if (details.length) replaceStages(current => current.map(stage => destinationKeys.includes(stage.clientKey) && !isTrainingStageDefinitionLocked(stage.id, current) ? {
      ...stage,
      Problems: [...stage.Problems, ...details.filter(({ problem }) => !stage.Problems.some(item => item.problemId === problem.id)).map(({ problem, alias }) => assignmentFromProblem(problem, alias))],
    } : stage));
    return { acceptedIds: details.map(({ problem }) => problem.id), rejected };
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
    if (stageReadOnly(target)) return toast.error("目标阶段已经开始，定义不可修改");
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


  const requestBody = (confirmDependentRemoval = false) => ({
    expectedRevision: statusRevisionRef.current || design?.statusRevision || 0,
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
      mode: stage.mode || "PRACTICE",
      accessPolicy: stage.accessPolicy || "ALL_AT_ONCE",
      submissionMode: stage.submissionMode || "ENABLED",
      endPolicy: stage.endPolicy || "MANUAL",
      plannedDurationSeconds: stage.plannedDurationSeconds ?? null,
      minDurationSeconds: stage.minDurationSeconds ?? null,
      completionThreshold: stage.completionThreshold ?? null,
      completionPolicy: stage.completionPolicy || undefined,
      rules: stage.rules || undefined,
      problems: stage.Problems.map((problem) => ({
        assignmentId: problem.assignmentId,
        clientKey: problem.clientKey,
        problemId: problem.problemId,
        alias: problem.alias || null,
        unlockPolicy: problem.unlockPolicy || undefined,
        targetScore: problem.targetScore ?? null,
        scoreGoals: problem.scoreGoals,
        timePolicy: problem.timePolicy || undefined,
        stuckPolicy: problem.stuckPolicy || undefined,
        allowedSubtaskIds: problem.allowedSubtaskIds,
        strategyIntervalSeconds: problem.strategyIntervalSeconds ?? null,
        required: problem.required !== false,
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
      `${safeTitle}-本地编排.json`,
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
      markDirty();
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
    if (loaded) toast.success(hadUnsavedChanges ? "已保留未保存的修改并加载最新内容" : "已加载最新内容");
  };
  const requestReload = () => {
    if (dirty) setReloadConfirmOpen(true);
    else void reloadFromServer();
  };

  const validate = async () => {
    const response = await validateTrainingDesign(sessionId, requestBody());
    if (!response.ok) {
      toast.error(response.error.userMessage || "结构校验失败");
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
  const save = async (confirmDependentRemoval = false, quiet = false): Promise<boolean> => {
    if (!design || saveInFlightRef.current) return false;
    saveInFlightRef.current = true;
    const capturedVersion = changeVersionRef.current;
    const body = requestBody(confirmDependentRemoval);
    setSaving(true);
    setSaveStatus("saving");
    const response = await saveTrainingDesign(sessionId, body).catch(() => null);
    saveInFlightRef.current = false;
    setSaving(false);
    if (!response) {
      setSaveStatus("error");
      if (!quiet) toast.error("网络异常，修改仍保留，请重试");
      return false;
    }
    if (!response.ok) {
      if (response.error.code === "TRAINING_STRUCTURE_REMOVAL_REQUIRES_CONFIRMATION") {
        setSaveStatus("dirty");
        setPendingRemovalConfirm(true);
        return false;
      }
      if (response.error.code === "TRAINING_SESSION_STALE") {
        persistRecoveryDraft();
        setSaveStatus("conflict");
        toast.error("另一名管理员已修改训练；完整本地编排已保存，可下载或在载入新版本后恢复");
      } else {
        setSaveStatus("error");
        if (!quiet) toast.error(response.error.userMessage || "保存失败");
      }
      return false;
    }
    const savedDesign = createTrainingDesignDraft(response.data);
    statusRevisionRef.current = savedDesign.statusRevision;
    const changedWhileSaving = changeVersionRef.current !== capturedVersion;
    setDesign(savedDesign);
    if (changedWhileSaving) {
      const savedStageByKey = new Map(savedDesign.stages.map(stage => [stage.clientKey, stage]));
      setStages(current => current.map(stage => {
        const savedStage = savedStageByKey.get(stage.clientKey);
        if (!savedStage) return stage;
        const savedProblemByKey = new Map(savedStage.Problems.map(problem => [problem.clientKey, problem]));
        return {
          ...stage,
          id: savedStage.id,
          Problems: stage.Problems.map(problem => {
            const savedProblem = savedProblemByKey.get(problem.clientKey);
            return savedProblem ? { ...problem, id: savedProblem.id, assignmentId: savedProblem.assignmentId } : problem;
          }),
        };
      }));
      const savedGroupByKey = new Map(savedDesign.groups.map(group => [group.clientKey, group]));
      setGrouping(current => current ? { ...current, groups: current.groups.map(group => {
        const savedGroup = savedGroupByKey.get(group.clientKey);
        return savedGroup ? { ...group, id: savedGroup.id } : group;
      }) } : current);
      setDirty(true);
      setSaveStatus("dirty");
    } else {
      setStages(savedDesign.stages);
      setGrouping({ groups: savedDesign.groups, memberships: savedDesign.participants.map(participant => {
        const group = savedDesign.groups.find(item => item.id === participant.groupId);
        return { participantId: participant.id, userId: participant.userId, groupId: participant.groupId, groupName: group?.name || "" };
      }) });
      setTitle(savedDesign.session.title);
      setDescription(savedDesign.session.description || "");
      setDirty(false);
      setSaveStatus("saved");
      clearRecoveryDraft();
    }
    setPendingRemovalConfirm(false);
    if (!quiet) toast.success("编排草稿已保存；未完成项会在发布检查中继续提示");
    return true;
  };
  saveRef.current = save;
  useEffect(() => {
    if (!dirty || saving || pendingRemovalConfirm || saveStatus !== "dirty" || !design?.editable) return;
    const timer = window.setTimeout(() => { void saveRef.current(false, true); }, 1200);
    return () => window.clearTimeout(timer);
  }, [description, design?.editable, dirty, grouping, pendingRemovalConfirm, saveStatus, saving, stages, title]);

  const openAuxiliary = async (panel: "roster" | "hints" | "matrix") => {
    if (dirty && !(await save(false, true))) return;
    setAuxiliaryPanel(panel);
  };
  const preparePublish = async () => {
    if (!design) return;
    if (dirty && !(await save(false, true))) return;
    if (!(await validate())) return;
    setPublishOpen(true);
  };
  const publish = async () => {
    if (!design) return;
    if (dirty && !(await save(false, true))) return;
    if (!(await validate())) return;
    setPublishing(true);
    const response = await publishTraining(sessionId, { expectedRevision: statusRevisionRef.current });
    setPublishing(false);
    if (!response.ok) return toast.error(response.error.userMessage || "发布失败");
    toast.success("训练已发布；阶段开始后其配置固定，运行调整请在训练工作台完成");
    requestNavigation(runtimePath);
  };
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
          title="训练编排"
          description={`${title || "未命名训练"} · ${design.participants.length} 名学员`}
          breadcrumbs={[
            { label: "训练", href: runtimePath.replace(/\/[^/]+$/, "") },
            { label: "训练编排" },
          ]}
          actions={<>
            <span className={`${styles.saveState} ${dirty ? styles.saveStateDirty : ""}`} role="status">
              {saveStatus === "saving" ? "正在自动保存…" : saveStatus === "conflict" ? "发生冲突，已保留本地副本" : saveStatus === "error" ? "保存失败，修改仍保留" : saveStatus === "dirty" ? "等待自动保存…" : "已自动保存"}
            </span>
            <Button variant="ghost" onClick={() => requestNavigation(runtimePath)}>返回课堂工作台</Button>
            <Button iconOnly variant="ghost" aria-label="重新加载" title="重新加载" onClick={requestReload} disabled={saving}><RefreshCw size={16} /></Button>
            {recoveryDraftAvailable && <>
              <Button iconOnly variant="ghost" aria-label="下载本地副本" title="下载本地副本" onClick={downloadRecoveryDraft}><Download size={16} /></Button>
              <Button iconOnly variant="ghost" aria-label="恢复本地副本" title="恢复本地副本" onClick={restoreRecoveryDraft}><RotateCcw size={16} /></Button>
            </>}
            <Button variant="outline" icon={<Eye size={16} />} onClick={() => setPreviewOpen(true)}>预览学生视角</Button>
            <Button variant="secondary" onClick={() => void save()} loading={saving} disabled={!dirty}>{saveStatus === "error" || saveStatus === "conflict" ? "重试保存" : "立即保存"}</Button>
            {design.session.status === "DRAFT" && <Button icon={<Send size={16} />} onClick={() => void preparePublish()} loading={publishing} disabled={saving}>发布训练</Button>}
          </>}
        />

        <section className={styles.designerIdentity} aria-label="训练基本信息">
          <label className={styles.field}>训练名称<Input value={title} onChange={event => { setTitle(event.target.value); markDirty() }} /></label>
          <label className={styles.field}>训练说明<Textarea rows={2} value={description} onChange={event => { setDescription(event.target.value); markDirty() }} /></label>
        </section>

        <div className={styles.designerCanvas}>
          <TrainingStageTimeline
            stages={stages}
            activeStageKey={activeStageKey}
            draggedIndex={draggedStage}
            onAdd={addStage}
            onSelect={stageKey => { setActiveStageKey(stageKey); setStageDrawerOpen(true) }}
            onDragStart={setDraggedStage}
            onDrop={index => {
              if (draggedStage != null && !stageReadOnly(stages[draggedStage]) && !stageReadOnly(stages[index])) {
                replaceStages(current => moveItem(current, draggedStage, index))
              }
              setDraggedStage(null)
            }}
            onMove={(from, to) => {
              if (!stageReadOnly(stages[from]) && !stageReadOnly(stages[to])) replaceStages(current => moveItem(current, from, to))
            }}
            onCopy={copyStage}
            isStageReadOnly={stageReadOnly}
            onRemove={removeStage}
          />

          <aside className={styles.designerSidebar} aria-label="训练编排辅助设置">
            <section className={styles.designerSummaryCard}>
              <div className={styles.designerSummaryHeading}><Users size={18} /><div><strong>学员与分组</strong><span>{design.participants.length} 名学员</span></div></div>
              <p>{(grouping?.groups.length || 0) > 1 ? `已启用分层训练 · ${grouping?.groups.length} 个组` : "所有学生使用相同训练内容"}</p>
              <Button variant="outline" icon={<Settings2 size={15} />} disabled={saving} onClick={() => void openAuxiliary("roster")}>设置学员与分组</Button>
              {(grouping?.groups.length || 0) > 1 && <Button variant="text" disabled={saving} onClick={() => void openAuxiliary("matrix")}>查看全部分组方案</Button>}
            </section>

            <section className={styles.designerSummaryCard}>
              <div className={styles.designerSummaryHeading}><Lightbulb size={18} /><div><strong>分级提示</strong><span>按训练题目配置</span></div></div>
              <p>设置手动、时间、提交次数或分数触发的提示。</p>
              <Button variant="outline" disabled={saving} onClick={() => void openAuxiliary("hints")}>管理提示</Button>
            </section>

            <section className={styles.designerSummaryCard}>
              <div className={styles.designerSummaryHeading}><Send size={18} /><div><strong>发布检查</strong><span>{issues.length ? `${issues.length} 项待确认` : "当前未发现问题"}</span></div></div>
              <dl className={styles.designerMetrics}>
                <div><dt>学员</dt><dd>{design.participants.length}</dd></div>
                <div><dt>阶段</dt><dd>{stages.length}</dd></div>
                <div><dt>题目</dt><dd>{stages.reduce((sum, stage) => sum + stage.Problems.length, 0)}</dd></div>
              </dl>
              {issues.length > 0 && <div className={styles.issueList}>{issues.slice(0, 3).map(issue => <Button variant="ghost" type="button" key={`${issue.path}-${issue.code}`} onClick={() => {
                const index = Number(issue.path.split(".")[1])
                if (Number.isInteger(index) && stages[index]) {
                  setActiveStageKey(stages[index].clientKey)
                  setStageDrawerOpen(true)
                }
              }}>{issue.message}</Button>)}</div>}
            </section>
          </aside>
        </div>
      </div>

      <TrainingStageDrawer
        isOpen={stageDrawerOpen}
        onClose={() => setStageDrawerOpen(false)}
        title={activeStage?.name || "阶段设置"}
        description={activeStageReadOnly ? "当前阶段已经开始，定义只读。" : "编辑这一段课堂流程与训练题目。"}
      >
        <TrainingProblemChain
          stages={stages}
          activeStage={activeStage}
          draggedProblem={draggedProblem}
          onDraggedProblemChange={setDraggedProblem}
          onUpdateStage={updateStage}
          onUpdateProblem={updateProblem}
          onMoveProblemToStage={moveProblemToStage}
          readOnly={activeStageReadOnly}
        />
        <section className={styles.drawerProblemPicker} aria-label="按题号添加">
          <div><strong>添加题目</strong><p>训练提交时使用当前可用的评测数据。</p></div>
          <label className={styles.field}>添加到<Select value={problemTarget} onChange={event => {
            const next = event.target.value as "current" | "multiple"
            setProblemTarget(next)
            if (next === "multiple" && !targetStages.length) setTargetStages(activeStage ? [activeStage.clientKey] : [])
          }}><option value="current">当前阶段</option><option value="multiple">选择多个阶段</option></Select></label>
          {problemTarget === "multiple" && <div className={styles.stack}>{stages.map(stage => <Checkbox
            key={stage.clientKey}
            label={stage.name}
            description={stageReadOnly(stage) ? "已开始，只读" : `${stage.Problems.length} 道题`}
            checked={targetStages.includes(stage.clientKey)}
            disabled={stageReadOnly(stage)}
            onChange={event => setTargetStages(current => event.target.checked ? [...current, stage.clientKey] : current.filter(key => key !== stage.clientKey))}
          />)}</div>}
          <ProblemReferenceSelector
            contextKey={JSON.stringify([activeStageKey, problemTarget, [...targetStages].sort()])}
            disabled={!stageDrawerOpen || saving || publishing || !activeStage || activeStageReadOnly || (problemTarget === "multiple" && !targetStages.length)}
            existingProblemIds={destinationProblemIds}
            onAdd={addResolvedProblems}
            dataRequirement="training"
          />
        </section>
      </TrainingStageDrawer>

      <FormDialog
        isOpen={Boolean(auxiliaryPanel)}
        onClose={() => setAuxiliaryPanel(null)}
        title={auxiliaryPanel === "roster" ? "学员与分组" : auxiliaryPanel === "hints" ? "提示" : "分组训练方案总览"}
        description={auxiliaryPanel === "roster" ? "先维护学员，再按需要开启分层训练。" : auxiliaryPanel === "hints" ? "按题目管理学生在训练中可以获得的提示。" : "为不同训练组设置每个阶段的题目、完成要求和推进方式。"}
        size="xl"
        footer={<><Button variant="secondary" onClick={() => setAuxiliaryPanel(null)}>关闭</Button>{auxiliaryPanel === "roster" && <Button onClick={() => void save()} loading={saving} disabled={!dirty}>保存分组修改</Button>}</>}
      >
        {auxiliaryPanel === "roster" && <TrainingDesignAuxiliary
          sessionId={sessionId}
          mode="roster"
          stages={stages}
          onStagesChange={replaceStages}
          grouping={grouping}
          sessionStatus={design.session.status}
          onGroupingChange={value => { setGrouping(value); markDirty() }}
          onRevisionChanged={revision => { statusRevisionRef.current = revision; setDesign(current => current ? { ...current, statusRevision: revision } : current) }}
        />}
        {auxiliaryPanel === "hints" && <TrainingDesignAuxiliary
          sessionId={sessionId}
          mode="hints"
          stages={stages}
          sessionStatus={design.session.status}
        />}
        {auxiliaryPanel === "matrix" && <TrainingStageGroupMatrix
          sessionId={sessionId}
          revision={design.statusRevision}
          stages={stages}
          grouping={grouping}
          stagePlans={design.stagePlans}
          onSaved={refreshDesign}
        />}
      </FormDialog>

      <FormDialog
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="学生视角预览"
        description={title}
        size="lg"
        footer={<Button onClick={() => setPreviewOpen(false)}>关闭预览</Button>}
      >
        <div className={styles.studentPreview}>
          <div className={styles.studentPreviewGoal}><span>你的目标</span><strong>完成当前阶段安排的训练题目</strong><p>{stages.length} 个阶段 · {stages.reduce((sum, stage) => sum + stage.Problems.length, 0)} 道题</p></div>
          <div className={styles.studentPreviewFlow}>{stages.map((stage, index) => <article key={stage.clientKey}>
            <span>{index + 1}</span>
            <div><strong>{stage.name}</strong><p>{stage.Problems.length ? stage.Problems.map(problem => problem.Problem.problemId).join(" · ") : "讲解或复盘"}</p></div>
            {stageReadOnly(stage) && <small>进行中或已完成</small>}
          </article>)}</div>
        </div>
      </FormDialog>

      <FormDialog
        isOpen={publishOpen}
        onClose={() => setPublishOpen(false)}
        onSubmit={() => void publish()}
        title={issues.some(issue => issue.severity === "error") ? "暂时无法发布" : "发布训练"}
        description="发布后，已经进入运行状态的阶段将受到版本保护。"
        submitText="确认发布"
        loading={publishing}
        submitDisabled={issues.some(issue => issue.severity === "error")}
      >
        <div className={styles.publishReview}>
          <dl>
            <div><dt>训练对象</dt><dd>{design.participants.length} 名学员</dd></div>
            <div><dt>训练流程</dt><dd>{stages.length} 个阶段</dd></div>
            <div><dt>训练题目</dt><dd>{stages.reduce((sum, stage) => sum + stage.Problems.length, 0)} 道题</dd></div>
          </dl>
          {issues.length > 0 && <div className={styles.publishIssues}><strong>需要处理</strong>{issues.map(issue => <Button variant="ghost" type="button" key={`${issue.path}-${issue.code}`} onClick={() => {
            const index = Number(issue.path.split(".")[1])
            setPublishOpen(false)
            if (Number.isInteger(index) && stages[index]) {
              setActiveStageKey(stages[index].clientKey)
              setStageDrawerOpen(true)
            }
          }}>{issue.message}</Button>)}</div>}
        </div>
      </FormDialog>
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
        title="加载其他位置的最新内容？"
        message="当前内容在其他位置已有更新。继续后会保留你尚未保存的修改，并加载最新内容。"
        confirmText="保存副本并重新加载"
        loading={loading}
      />
    </PageFrame>
  )
}
