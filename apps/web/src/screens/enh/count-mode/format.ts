export function trimQty(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

export function signedQty(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const trimmed = trimQty(value);
  if (trimmed === "0") return "0";
  return trimmed.startsWith("-") ? trimmed : `+${trimmed}`;
}

export enum VarianceDirection {
  Matched = "matched",
  Over = "over",
  Short = "short",
  Unknown = "unknown",
}

export function varianceDirection(varianceQty: string | null | undefined): VarianceDirection {
  if (varianceQty === null || varianceQty === undefined || varianceQty === "") return VarianceDirection.Unknown;
  const trimmed = trimQty(varianceQty);
  if (trimmed === "0") return VarianceDirection.Matched;
  return trimmed.startsWith("-") ? VarianceDirection.Short : VarianceDirection.Over;
}

export function percentOf(done: number, total: number): number {
  return total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100));
}
