export interface LedgerPresenceInput {
  readonly date: string;
  readonly live: boolean;
  readonly endedOn: string | null;
}

export function ledgerPresenceAsOf(doc: LedgerPresenceInput, asOfDate: string | undefined): -1 | 0 | 1 {
  if (asOfDate === undefined) return doc.live ? 1 : 0;
  if (!doc.live && doc.endedOn === null) return 0;
  const posted = doc.date.slice(0, 10) <= asOfDate ? 1 : 0;
  const ended = !doc.live && doc.endedOn !== null && doc.endedOn.slice(0, 10) <= asOfDate ? 1 : 0;
  return (posted - ended) as -1 | 0 | 1;
}

export function reversalChainPresenceAsOf(linkDates: readonly string[], asOfDate: string | undefined): number {
  let presence = 0;
  linkDates.forEach((date, index) => {
    if (asOfDate !== undefined && date.slice(0, 10) > asOfDate) return;
    presence += index % 2 === 0 ? 1 : -1;
  });
  return presence;
}
