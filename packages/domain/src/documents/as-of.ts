export interface LedgerPresenceInput {
  readonly date: string;
  readonly live: boolean;
  readonly endedOn: string | null;
}

/**
 * How many times a document's posting stands in the ledger at `asOfDate`: once
 * from its own date, and no longer from the day its reversal is DATED. The
 * ledger keeps both entries where they were dated, so a sub-ledger that drops a
 * document because it is reversed today disagrees with every month end between
 * the two dates. `-1` is the reversal dated before the document it undoes.
 */
export function ledgerPresenceAsOf(doc: LedgerPresenceInput, asOfDate: string | undefined): -1 | 0 | 1 {
  if (asOfDate === undefined) return doc.live ? 1 : 0;
  if (!doc.live && doc.endedOn === null) return 0;
  const posted = doc.date.slice(0, 10) <= asOfDate ? 1 : 0;
  const ended = !doc.live && doc.endedOn !== null && doc.endedOn.slice(0, 10) <= asOfDate ? 1 : 0;
  return (posted - ended) as -1 | 0 | 1;
}
