import { describe, expect, it } from "vitest";
import {
  candidateSourceLabel,
  contributionRewardPresentation,
  contributionScoreLabel,
  contributionStatusPresentation,
  contributionTypeLabel,
  selectionModeLabel,
} from "./contribution-display";

describe("contribution display contract", () => {
  it("uses product language for contribution evidence", () => {
    expect(contributionTypeLabel("hack_promoted")).toBe("Hack 数据正式晋升");
    expect(candidateSourceLabel("direct_data")).toBe("直接数据");
    expect(selectionModeLabel("emergency")).toBe("管理员紧急发布");
  });

  it("does not imply that a pending or rejected contribution has been rewarded", () => {
    expect(contributionStatusPresentation("pending")).toEqual({ label: "待平台审核", variant: "pending" });
    expect(contributionRewardPresentation("pending", null).label).toBe("审核通过后创建奖励");
    expect(contributionRewardPresentation("rejected", null).label).toBe("未发放奖励");
    expect(contributionScoreLabel("pending", 100)).toBe("审核通过后 +100");
    expect(contributionScoreLabel("revoked", 100)).toBe("未计入");
  });

  it("shows posted and failed delivery states distinctly", () => {
    expect(contributionRewardPresentation("accepted", { status: "posted", userCarits: "20" })).toEqual({ label: "+20 C", variant: "success" });
    expect(contributionRewardPresentation("accepted", { status: "failed", userCarits: "20" }).variant).toBe("error");
  });
});
