export function hasPositiveCaritsDebt(value?: string): boolean {
  return typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > BigInt(0);
}

export function canAffordCarits(available?: string, cost?: string): boolean {
  return typeof available === "string"
    && typeof cost === "string"
    && /^\d+$/.test(available)
    && /^[1-9]\d*$/.test(cost)
    && BigInt(available) >= BigInt(cost);
}

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  contribution_reward: "贡献奖励",
  contribution_reward_reversal: "贡献奖励冲正",
  evaluation_credit_purchase: "评测额度兑换",
  manual_adjustment: "管理员调整",
};

const TRANSACTION_SOURCE_LABELS: Record<string, string> = {
  contribution_event: "正式测试集贡献",
  resource_purchase: "评测额度兑换",
  system: "系统调整",
};

export function walletTransactionTypeLabel(value: string): string {
  return TRANSACTION_TYPE_LABELS[value] || "其他资产变动";
}

export function walletTransactionSourceLabel(value: string): string {
  return TRANSACTION_SOURCE_LABELS[value] || "来源待确认";
}

export function resourcePurchaseStatusLabel(value: string): string {
  const labels: Record<string, string> = {
    posted: "已到账",
    pending: "处理中",
    failed: "兑换失败",
    reversed: "已冲正",
  };
  return labels[value] || "状态待确认";
}
