import { describe, expect, it } from "vitest";
import { hasPositiveCaritsDebt } from "./wallet-display";

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
});
