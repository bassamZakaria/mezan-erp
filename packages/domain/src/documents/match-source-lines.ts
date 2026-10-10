import { Qty } from "../money/index.js";

export interface SourceLineKey {
  readonly itemId: string;
  readonly sourceLineId?: string | null;
}

export interface MatchedSourceLine<L, R> {
  readonly line: L;
  readonly request: R;
}

/**
 * Pairs each return request with the ONE source-invoice line it reverses.
 *
 * A request that names `sourceLineId` takes exactly that line. One that names
 * only the item — every caller written before lines could be named — takes the
 * first line of that item no other request has claimed. An item sold on two
 * lines at two tax rates is therefore returned under the rate of the line the
 * caller named, and never against both lines at once.
 */
export function matchSourceLines<L extends SourceLineKey, R extends SourceLineKey>(
  lines: readonly L[],
  requests: readonly R[],
): MatchedSourceLine<L, R>[] {
  const claimed = new Map<number, R>();
  const claim = (request: R, matches: (line: L) => boolean): void => {
    const index = lines.findIndex((line, i) => !claimed.has(i) && matches(line));
    if (index >= 0) claimed.set(index, request);
  };
  for (const request of requests) {
    if (request.sourceLineId) claim(request, (line) => line.sourceLineId === request.sourceLineId && line.itemId === request.itemId);
  }
  for (const request of requests) {
    if (!request.sourceLineId) claim(request, (line) => line.itemId === request.itemId);
  }
  return [...claimed.entries()].sort(([a], [b]) => a - b).map(([index, request]) => ({ line: lines[index] as L, request }));
}

/**
 * What confirmed returns have already taken from EACH source line.
 *
 * A return that names its line counts against that line. One stored before
 * lines could be named counts against the lines of its item in order, each up
 * to what that line still has — the same first-line rule `matchSourceLines`
 * uses, so the limit a return is checked against is the limit it was built on.
 */
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
