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

const LARGEST_PLAIN_DECIMAL = 1e21;

// A cleared quantity field holds NaN: it takes nothing from its line. The
// result is always a plain decimal — `String(1e-7)` is "1e-7", which the
// money parser cannot read.
export function formQtyOf(qty: number): string {
  if (!Number.isFinite(qty) || qty <= 0) return "0";
  return qty < LARGEST_PLAIN_DECIMAL ? qty.toFixed(6) : String(Number.MAX_SAFE_INTEGER);
}

export interface ServerSourceLine {
  readonly sourceLineId: string;
  readonly soldQty: string;
  readonly returnedQty: string;
}

// The line a new return row starts on: the first with room once what
// CONFIRMED returns took (the server's figure) and what the form's own rows
// take are both counted.
export function nextReturnSourceLine(
  serverLines: readonly ServerSourceLine[],
  formRows: readonly { readonly sourceLineId: string; readonly qty: number }[],
  fallbackLineId: string,
): string {
  const sold = serverLines.map((line) => ({ sourceLineId: line.sourceLineId, qty: line.soldQty }));
  const taken = [
    ...serverLines.map((line) => ({ sourceLineId: line.sourceLineId, qty: line.returnedQty })),
    ...formRows.map((row) => ({ sourceLineId: row.sourceLineId, qty: formQtyOf(row.qty) })),
  ];
  return firstSourceLineWithRoom(sold, taken) ?? fallbackLineId;
}
