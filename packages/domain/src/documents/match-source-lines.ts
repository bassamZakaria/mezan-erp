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
