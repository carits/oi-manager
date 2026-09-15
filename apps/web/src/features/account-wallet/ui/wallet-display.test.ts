import { describe, expect, it } from "vitest";
import {
  canAffordCarits,
  hasPositiveCaritsDebt,
  resourcePurchaseStatusLabel,
  walletTransactionSourceLabel,
  walletTransactionTypeLabel,
} from "./wallet-display";

describe("wallet debt display", () => {
  it("does not render debt for an account that has not been created", () => {
    expect(hasPositiveCaritsDebt(undefined)).toBe(false);
  });

  it("only renders a positive debt", () => {
    expect(hasPositiveCaritsDebt("0")).toBe(false);
    expect(hasPositiveCaritsDebt("25")).toBe(true);
    expect(hasPositiveCaritsDebt("-1")).toBe(false);
    expect(hasPositiveCaritsDebt("invalid")).toBe(false);
  });

  it("compares Carits amounts without losing bigint precision", () => {
    expect(canAffordCarits("900719925474099312345", "900719925474099312344")).toBe(true);
    expect(canAffordCarits("9", "10")).toBe(false);
    expect(canAffordCarits(undefined, "10")).toBe(false);
  });

  it("uses friendly ledger labels", () => {
    expect(walletTransactionTypeLabel("contribution_reward")).toBe("贡献奖励");
    expect(walletTransactionSourceLabel("resource_purchase")).toBe("评测额度兑换");
    expect(resourcePurchaseStatusLabel("posted")).toBe("已到账");
  });
});
