import { Qty } from "../money/index.js";

export interface SourceLineKey {
  readonly itemId: string;
  readonly sourceLineId?: string | null;
}

export interface ReturnableSourceLine extends SourceLineKey {
  readonly qty: Qty;
  readonly alreadyReturnedQty: Qty;
}

export interface SourceLineRequest extends SourceLineKey {
  readonly qty: Qty;
}

export interface MatchedSourceLine<L, R> {
  readonly line: L;
  readonly request: R;
}

export interface SourceLineMatch<L, R> {
  readonly matched: MatchedSourceLine<L, R>[];
  readonly unmatched: R[];
}

// INVARIANT: a request naming a line is matched to it however many other
// requests name it too — the total asked of one line is refused by
// `overdrawnSourceLines`, and a matcher that hid the second request would hide
// the overdraw with it.
export function matchSourceLines<L extends ReturnableSourceLine, R extends SourceLineRequest>(
  lines: readonly L[],
  requests: readonly R[],
): SourceLineMatch<L, R> {
  const taken = lines.map((line) => line.alreadyReturnedQty);
  const claimedInBatch = new Set<number>();
  const assigned: { index: number; order: number; request: R }[] = [];
  const unmatched: R[] = [];
  const roomOf = (index: number): Qty => (lines[index] as L).qty.subtract(taken[index] as Qty);
  const assign = (index: number, order: number, request: R): void => {
    taken[index] = (taken[index] as Qty).add(request.qty);
    claimedInBatch.add(index);
    assigned.push({ index, order, request });
  };

  requests.forEach((request, order) => {
    if (!request.sourceLineId) return;
    const index = lines.findIndex((line) => line.sourceLineId === request.sourceLineId && line.itemId === request.itemId);
    if (index < 0) unmatched.push(request);
    else assign(index, order, request);
  });

  requests.forEach((request, order) => {
    if (request.sourceLineId) return;
    const ofItem = lines.flatMap((line, index) => (line.itemId === request.itemId ? [index] : []));
    const fits = (index: number): boolean => roomOf(index).compare(request.qty) >= 0;
    const hasRoom = (index: number): boolean => roomOf(index).compare(Qty.zero()) > 0;
    const index =
      ofItem.find((i) => !claimedInBatch.has(i) && fits(i)) ??
      ofItem.find(fits) ??
      ofItem.find(hasRoom) ??
      ofItem[0];
    if (index === undefined) unmatched.push(request);
    else assign(index, order, request);
  });

  const matched = assigned
    .sort((a, b) => a.index - b.index || a.order - b.order)
    .map(({ index, request }) => ({ line: lines[index] as L, request }));
  return { matched, unmatched: unmatched.sort((a, b) => requests.indexOf(a) - requests.indexOf(b)) };
}

export interface OverdrawnSourceLine<L> {
  readonly line: L;
  readonly requested: Qty;
  readonly available: Qty;
}

export function overdrawnSourceLines<L extends ReturnableSourceLine, R extends SourceLineRequest>(
  lines: readonly L[],
  requests: readonly R[],
): { readonly overdrawn: OverdrawnSourceLine<L>[]; readonly unmatched: R[] } {
  const { matched, unmatched } = matchSourceLines(lines, requests);
  const requestedByLine = new Map<L, Qty>();
  for (const { line, request } of matched) {
    requestedByLine.set(line, (requestedByLine.get(line) ?? Qty.zero()).add(request.qty));
  }
  const overdrawn: OverdrawnSourceLine<L>[] = [];
  for (const [line, requested] of requestedByLine) {
    const available = line.qty.subtract(line.alreadyReturnedQty);
    if (requested.compare(available) > 0) overdrawn.push({ line, requested, available });
  }
  return { overdrawn, unmatched };
}

// INVARIANT: a stored return that names no line fills its item's lines first
// to last, each up to what it has left — the same order `matchSourceLines`
// looks for room in, so a new return is offered exactly the room this leaves.
export function returnedQtyBySourceLine(
  lines: readonly (SourceLineKey & { readonly qty: Qty })[],
  returned: readonly (SourceLineKey & { readonly qty: Qty })[],
): Qty[] {
  const taken = lines.map(() => Qty.zero());
  const namedLineOf = (r: SourceLineKey): number =>
    r.sourceLineId ? lines.findIndex((l) => l.sourceLineId === r.sourceLineId && l.itemId === r.itemId) : -1;
  for (const r of returned) {
    const index = namedLineOf(r);
    if (index >= 0) taken[index] = (taken[index] as Qty).add(r.qty);
  }
  for (const r of returned) {
    if (namedLineOf(r) >= 0) continue;
    let remaining = r.qty;
    const ofItem = lines.flatMap((l, index) => (l.itemId === r.itemId ? [index] : []));
    ofItem.forEach((index, position) => {
      const room = (lines[index] as { qty: Qty }).qty.subtract(taken[index] as Qty);
      const isLast = position === ofItem.length - 1;
      const part = isLast || remaining.compare(room) <= 0 ? remaining : room.isNegative() ? Qty.zero() : room;
      taken[index] = (taken[index] as Qty).add(part);
      remaining = remaining.subtract(part);
    });
  }
  return taken;
}
