import type { BadgeVariant } from "@/components/ui/Badge";

export type ContributionEventStatus = "pending" | "accepted" | "rejected" | "revoked" | string;

const CONTRIBUTION_TYPE_LABELS: Record<string, string> = {
  candidate_promoted: "候选测试数据被采用",
  hack_promoted: "反例数据被采用",
};

const CONTRIBUTION_SOURCE_LABELS: Record<string, string> = {
  testcase_candidate: "候选测试数据",
  contribution_event: "贡献奖励",
  resource_purchase: "评测额度兑换",
  system: "系统",
};

const CANDIDATE_SOURCE_LABELS: Record<string, string> = {
  direct_data: "直接数据",
  generator: "自动生成",
  hack: "反例提交",
  admin_import: "管理员导入",
};

const SELECTION_MODE_LABELS: Record<string, string> = {
  auto: "系统自动采用",
  emergency: "管理员紧急采用",
};

export function contributionTypeLabel(value: string): string {
  return CONTRIBUTION_TYPE_LABELS[value] || "其他贡献";
}

export function contributionSourceLabel(value: string): string {
  return CONTRIBUTION_SOURCE_LABELS[value] || "来源待确认";
}

export function candidateSourceLabel(value?: string | null): string {
  return value ? CANDIDATE_SOURCE_LABELS[value] || "来源待确认" : "—";
}

export function selectionModeLabel(value?: string | null): string {
  return value ? SELECTION_MODE_LABELS[value] || "处理方式待确认" : "—";
}

export function contributionStatusPresentation(status: ContributionEventStatus): {
  label: string;
  variant: BadgeVariant;
} {
  const presentations: Record<string, { label: string; variant: BadgeVariant }> = {
    pending: { label: "待平台审核", variant: "pending" },
    accepted: { label: "已接受", variant: "success" },
    rejected: { label: "已拒绝", variant: "error" },
    revoked: { label: "已撤销", variant: "error" },
  };
  return presentations[status] || { label: "状态待确认", variant: "neutral" };
}

export function contributionScoreLabel(status: ContributionEventStatus, score: number): string {
  if (status === "accepted") return `+${score}`;
  if (status === "pending") return `审核通过后 +${score}`;
  if (status === "rejected" || status === "revoked") return "未计入";
  return `状态待确认 · ${score}`;
}

export function contributionRewardPresentation(
  contributionStatus: ContributionEventStatus,
  delivery?: { status: string; userCarits: string } | null,
): { label: string; variant: BadgeVariant } {
  if (!delivery) {
    if (contributionStatus === "pending") return { label: "审核通过后创建奖励", variant: "neutral" };
    if (contributionStatus === "rejected") return { label: "未发放奖励", variant: "neutral" };
    if (contributionStatus === "revoked") return { label: "奖励已取消", variant: "neutral" };
    return { label: "奖励任务待创建", variant: "pending" };
  }
  const labels: Record<string, string> = {
    pending: "奖励待结算",
    deferred_budget: "受每日额度限制，已延后",
    posted: `+${delivery.userCarits} C`,
    reversing: "奖励冲正中",
    reversed: "奖励已冲正",
    cancelled: "奖励已取消",
    failed: "结算失败，等待管理员处理",
  };
  const variants: Record<string, BadgeVariant> = {
    pending: "pending",
    deferred_budget: "warning",
    posted: "success",
    reversing: "warning",
    reversed: "error",
    cancelled: "neutral",
    failed: "error",
  };
  return {
    label: labels[delivery.status] || "奖励状态待确认",
    variant: variants[delivery.status] || "neutral",
  };
}
