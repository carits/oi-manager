export type LifecycleTone = "success" | "warning" | "error" | "pending" | "neutral";

const STAGE_LABELS: Record<string, string> = {
  received: "已接收",
  generator_compile: "生成程序准备",
  generator_determinism: "确定性检查",
  validator: "输入数据检查",
  standard: "标准答案生成",
  checker: "答案校验",
  deduplication: "重复检测",
  classification: "数据分组",
  value_evaluation: "价值评估",
  awaiting_classifier: "等待数据分组",
  awaiting_corpus: "等待历史数据检查",
  awaiting_evaluator: "等待价值评估",
  awaiting_evaluation_budget: "等待评估额度",
  queued_l1: "价值评估排队中",
  queued_l2: "深入评估排队中",
  queued_holdout: "质量检查排队中",
  evaluated: "价值评估完成",
  observed_limited: "评估完成，当前仅观察",
  no_marginal_value: "未发现明显提升",
  technical_validated: "初步检查通过",
  technical_hack_evidence: "补充数据有效，等待质量检查",
  bootstrap_ready: "可作为基础数据",
  candidate_pool: "已进入候选数据池",
  selector_promoting: "正在更新评测数据",
  selector_not_selected: "本次未达到采用要求",
  waiting_replacement: "等待更新评测数据",
  promoted: "已纳入评测数据",
  base_revision_stale: "评测数据已有更新",
  evaluation_projection_invalid: "当前无法完成质量评估",
  evaluation_system_error: "质量评估暂时失败",
  blob_persist_failed: "候选数据保存失败",
  canonical_duplicate: "与现有评测数据重复",
  cancelled: "已取消",
  completed: "处理完成",
  failed: "处理失败",
  input: "输入检查",
  generator: "数据生成",
};

export function contributionStageLabel(stage?: string | null): string {
  if (!stage) return "处理阶段未知";
  return STAGE_LABELS[stage] || "处理状态待确认";
}

export function candidateLifecyclePresentation(
  status?: string | null,
  stage?: string | null,
  _promotedGraphHash?: string | null,
): { label: string; detail: string; tone: LifecycleTone } {
  const normalized = status?.toUpperCase() || "";
  const stageLabel = contributionStageLabel(stage);
  if (normalized === "PROMOTED") return { label: "已纳入评测数据", detail: stageLabel, tone: "success" };
  if (normalized === "ELIGIBLE") return { label: "初步检查通过，等待质量评估", detail: stageLabel, tone: "pending" };
  if (normalized === "SELECTED" || normalized.startsWith("EVALUATING_")) return { label: "价值评估中", detail: stageLabel, tone: "pending" };
  if (normalized === "WAITING_REPLACEMENT") return { label: "候选数据有效，等待更新评测数据", detail: stageLabel, tone: "warning" };
  if (normalized === "ELIGIBLE_NOT_SELECTED") return { label: "数据有效，本次未达到采用要求", detail: stageLabel, tone: "warning" };
  if (normalized === "REDUNDANT") return { label: "与现有评测数据重复", detail: stageLabel, tone: "neutral" };
  if (normalized === "REJECTED") return { label: stage === "cancelled" ? "已取消" : "已拒绝", detail: stageLabel, tone: "error" };
  if (normalized === "FAILED") return { label: "处理失败", detail: stageLabel, tone: "error" };
  if (normalized === "STALE") return { label: "评测数据已有更新", detail: stageLabel, tone: "warning" };
  if (normalized === "EXPIRED") return { label: "候选数据已过期", detail: stageLabel, tone: "neutral" };
  if (normalized === "ADMITTED" || normalized === "VALIDATING" || normalized === "UPLOADED" || normalized === "VALIDATED") return { label: stageLabel, detail: "尚未完成价值评估", tone: "pending" };
  return { label: status ? "状态待确认" : stageLabel, detail: stageLabel, tone: "neutral" };
}

export function hackCanonicalPresentation(input: {
  technicalStatus: string;
  canonicalStatus?: string | null;
  candidateStatus?: string | null;
  promotedGraphHash?: string | null;
}): { label: string; tone: LifecycleTone } {
  if (input.technicalStatus !== "accepted") {
    if (input.technicalStatus === "rejected") return { label: "反例无效", tone: "warning" };
    if (input.technicalStatus === "system_error") return { label: "反例检查失败", tone: "error" };
    return { label: "反例检查中", tone: "pending" };
  }
  if (input.canonicalStatus === "promoted") return { label: "已纳入评测数据", tone: "success" };
  if (input.canonicalStatus === "redundant") return { label: "反例有效，本次未采用", tone: "warning" };
  if (input.canonicalStatus === "rejected") return { label: "候选数据已拒绝", tone: "error" };
  if (input.canonicalStatus === "failed") return { label: "候选处理失败", tone: "error" };
  const candidate = candidateLifecyclePresentation(input.candidateStatus);
  return { label: input.canonicalStatus === "pending" ? `反例有效 · ${candidate.label}` : "反例有效 · 状态待确认", tone: input.canonicalStatus === "pending" ? candidate.tone : "neutral" };
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
  const normalized = aliases[current] ?? (steps.includes(current) ? current : 'unknown');
  const currentIndex = steps.indexOf(normalized);
  if (currentIndex < 0) return [{ stage: "unknown", label: contributionStageLabel(current), state: input.status === "failed" ? "failed" : "current" }];
  return steps.map((stage, index) => ({
    stage,
    label: contributionStageLabel(stage),
    state: input.status === "failed" && index === currentIndex ? "failed" : index < currentIndex ? "done" : index === currentIndex ? "current" : "pending",
  }));
}
