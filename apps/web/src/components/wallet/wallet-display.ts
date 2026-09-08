export function hasPositiveCaritsDebt(value?: string): boolean {
  return typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > BigInt(0);
}
