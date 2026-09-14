export type LifecycleTone = "success" | "warning" | "error" | "pending" | "neutral";

const STAGE_LABELS: Record<string, string> = {
  received: "已接收",
  generator_compile: "Generator 编译",
  generator_determinism: "确定性检查",
  validator: "Validator 校验",
  standard: "STD 生成答案",
  checker: "Checker 自检",
  deduplication: "重复检测",
  classification: "Subtask 分类",
  value_evaluation: "价值评估",
  awaiting_classifier: "等待 Classifier",
  awaiting_corpus: "等待评估语料",
  awaiting_evaluator: "等待价值评估",
  awaiting_evaluation_budget: "等待评估额度",
  queued_l1: "L1 价值评估排队中",
  queued_l2: "L2 价值评估排队中",
  queued_holdout: "Hidden Holdout 评估排队中",
  evaluated: "价值评估完成",
  observed_limited: "评估完成，当前仅观察",
  no_marginal_value: "未发现新的边际价值",
  technical_validated: "技术验证通过",
  technical_hack_evidence: "技术 Hack 有效，等待 Selector",
  bootstrap_ready: "可作为基础核心数据",
  candidate_pool: "已进入 Candidate Pool",
  selector_promoting: "正在创建正式版本",
  selector_not_selected: "未达到正式测试集的边际价值门槛",
  waiting_replacement: "等待正式测试集替换窗口",
  promoted: "已纳入正式版本",
  base_revision_stale: "基础版本已变化",
  evaluation_projection_invalid: "评估配置不可用",
  evaluation_system_error: "评估系统错误",
  blob_persist_failed: "候选数据保存失败",
  canonical_duplicate: "与正式数据重复",
  cancelled: "已取消",
  completed: "处理完成",
  failed: "处理失败",
  input: "输入检查",
  generator: "Generator 执行",
};

export function contributionStageLabel(stage?: string | null): string {
  if (!stage) return "处理阶段未知";
  return STAGE_LABELS[stage] || `未识别阶段：${stage}`;
}

export function candidateLifecyclePresentation(
  status?: string | null,
  stage?: string | null,
  promotedRevision?: number | string | null,
): { label: string; detail: string; tone: LifecycleTone } {
  const normalized = status?.toUpperCase() || "";
  const stageLabel = contributionStageLabel(stage);
  if (normalized === "PROMOTED") return { label: promotedRevision ? `已纳入 R${promotedRevision}` : "已纳入正式版本", detail: stageLabel, tone: "success" };
  if (normalized === "ELIGIBLE") return { label: "有效候选，等待 Selector", detail: stageLabel, tone: "pending" };
  if (normalized === "SELECTED" || normalized.startsWith("EVALUATING_")) return { label: "价值评估中", detail: stageLabel, tone: "pending" };
  if (normalized === "WAITING_REPLACEMENT") return { label: "有效候选，等待替换窗口", detail: stageLabel, tone: "warning" };
  if (normalized === "ELIGIBLE_NOT_SELECTED") return { label: "技术有效，未达到边际价值门槛", detail: stageLabel, tone: "warning" };
  if (normalized === "REDUNDANT") return { label: "与现有数据冗余", detail: stageLabel, tone: "neutral" };
  if (normalized === "REJECTED") return { label: stage === "cancelled" ? "已取消" : "已拒绝", detail: stageLabel, tone: "error" };
  if (normalized === "FAILED") return { label: "处理失败", detail: stageLabel, tone: "error" };
  if (normalized === "STALE") return { label: "基础版本已变化", detail: stageLabel, tone: "warning" };
  if (normalized === "EXPIRED") return { label: "候选数据已过期", detail: stageLabel, tone: "neutral" };
  if (normalized === "ADMITTED" || normalized === "VALIDATING" || normalized === "UPLOADED" || normalized === "VALIDATED") return { label: stageLabel, detail: "尚未完成价值评估", tone: "pending" };
  return { label: status ? `未识别状态：${status}` : stageLabel, detail: stageLabel, tone: "neutral" };
}

export function hackCanonicalPresentation(input: {
  technicalStatus: string;
  canonicalStatus?: string | null;
  candidateStatus?: string | null;
  promotedRevision?: number | null;
}): { label: string; tone: LifecycleTone } {
  if (input.technicalStatus !== "accepted") {
    if (input.technicalStatus === "rejected") return { label: "技术 Hack 无效", tone: "warning" };
    if (input.technicalStatus === "system_error") return { label: "技术判定失败", tone: "error" };
    return { label: "技术判定进行中", tone: "pending" };
  }
  if (input.canonicalStatus === "promoted") return { label: input.promotedRevision ? `已纳入 R${input.promotedRevision}` : "已纳入正式版本", tone: "success" };
  if (input.canonicalStatus === "redundant") return { label: "技术有效，未纳入正式版本", tone: "warning" };
  if (input.canonicalStatus === "rejected") return { label: "候选数据已拒绝", tone: "error" };
  if (input.canonicalStatus === "failed") return { label: "候选处理失败", tone: "error" };
  const candidate = candidateLifecyclePresentation(input.candidateStatus);
  return { label: input.canonicalStatus === "pending" ? `技术有效 · ${candidate.label}` : "技术有效 · 候选状态未知", tone: input.canonicalStatus === "pending" ? candidate.tone : "neutral" };
}

export type TimelineItem = { stage: string; label: string; state: "done" | "current" | "pending" | "failed" };

export function buildContributionTimeline(input: { sourceMode: string; status: string; stage?: string | null }): TimelineItem[] {
  const current = input.stage || "";
  const steps = input.sourceMode === "generator"
    ? ["received", "generator_compile", "generator_determinism", "validator", "standard", "deduplication", "classification", "value_evaluation", "candidate_pool"]
    : ["received", "validator", "standard", "deduplication", "classification", "value_evaluation", "candidate_pool"];
  const aliases: Record<string, string> = {
    awaiting_classifier: "classification",
    awaiting_corpus: "value_evaluation",
    awaiting_evaluator: "value_evaluation",
    awaiting_evaluation_budget: "value_evaluation",
    queued_l1: "value_evaluation",
    queued_l2: "value_evaluation",
    queued_holdout: "value_evaluation",
    evaluated: "value_evaluation",
    observed_limited: "value_evaluation",
    no_marginal_value: "value_evaluation",
    selector_not_selected: "candidate_pool",
    waiting_replacement: "candidate_pool",
    technical_hack_evidence: "candidate_pool",
    selector_promoting: "candidate_pool",
    promoted: "candidate_pool",
    completed: "candidate_pool",
  };
  const normalized = aliases[current] || current;
  const currentIndex = steps.indexOf(normalized);
  if (currentIndex < 0) return [{ stage: current || "unknown", label: contributionStageLabel(current), state: input.status === "failed" ? "failed" : "current" }];
  return steps.map((stage, index) => ({
    stage,
    label: contributionStageLabel(stage),
    state: input.status === "failed" && index === currentIndex ? "failed" : index < currentIndex ? "done" : index === currentIndex ? "current" : "pending",
  }));
}
