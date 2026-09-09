import { describe, expect, it } from "vitest";
import {
  buildContributionTimeline,
  candidateLifecyclePresentation,
  contributionStageLabel,
  hackCanonicalPresentation,
} from "./problem-contribution-display";

describe("problem contribution lifecycle display", () => {
  it("distinguishes technical Hack success from canonical promotion", () => {
    expect(hackCanonicalPresentation({ technicalStatus: "accepted", canonicalStatus: "pending", candidateStatus: "ELIGIBLE" }).label).toContain("等待 Selector");
    expect(hackCanonicalPresentation({ technicalStatus: "accepted", canonicalStatus: "promoted", promotedRevision: 12 }).label).toBe("已纳入 R12");
  });

  it("describes candidate terminal states without claiming promotion", () => {
    expect(candidateLifecyclePresentation("ELIGIBLE_NOT_SELECTED", "selector_not_selected").label).toContain("未达到");
    expect(candidateLifecyclePresentation("WAITING_REPLACEMENT", "waiting_replacement").label).toContain("等待替换");
  });

  it("shows unknown backend stages honestly instead of marking admission current", () => {
    const timeline = buildContributionTimeline({ sourceMode: "input", status: "running", stage: "future_stage" });
    expect(timeline).toEqual([{ stage: "future_stage", label: "未识别阶段：future_stage", state: "current" }]);
    expect(contributionStageLabel("future_stage")).toContain("future_stage");
  });
});
