import { scaledOf } from "../lib/money";

export interface ReturnableSourceLine {
  readonly sourceLineId: string;
  readonly itemId: string;
  readonly label: string;
}

export interface SourceLineOption {
  readonly value: string;
  readonly label: string;
}

export function sourceLineOptions(lines: readonly ReturnableSourceLine[]): SourceLineOption[] {
  const perItem = new Map<string, number>();
  for (const line of lines) perItem.set(line.itemId, (perItem.get(line.itemId) ?? 0) + 1);
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const position = (seen.get(line.itemId) ?? 0) + 1;
    seen.set(line.itemId, position);
    const repeated = (perItem.get(line.itemId) ?? 0) > 1;
    return { value: line.sourceLineId, label: repeated ? `${line.label} · ${position}` : line.label };
  });
}

export interface SourceLineQty {
  readonly sourceLineId: string;
  readonly qty: string;
}

export function firstSourceLineWithRoom(sold: readonly SourceLineQty[], taken: readonly SourceLineQty[]): string | null {
  const takenByLine = new Map<string, bigint>();
  for (const t of taken) takenByLine.set(t.sourceLineId, (takenByLine.get(t.sourceLineId) ?? 0n) + scaledOf(t.qty));
  return sold.find((line) => scaledOf(line.qty) - (takenByLine.get(line.sourceLineId) ?? 0n) > 0n)?.sourceLineId ?? null;
}
