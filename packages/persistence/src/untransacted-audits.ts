const MOST_RECENT = 200;

// The suites and the seed drives drain these after every test and assert they
// are empty. A server never drains them, so each keeps only the most recent
// reports and every report is logged where an operator will see it.
export function keepRecent(reports: string[], report: string): void {
  reports.push(report);
  if (reports.length > MOST_RECENT) reports.splice(0, reports.length - MOST_RECENT);
}

const reported: string[] = [];

// Every change-log event appended by a mutating request OUTSIDE any
// transaction, since the last drain: the event and the write it records could
// then part company — one committed, the other lost.
export function reportUntransactedAudit(event: string): void {
  keepRecent(reported, event);
  console.error(`[audit] ${event} was appended outside any transaction, so the write it records can commit or roll back without it`);
}

export function drainUntransactedAudits(): string[] {
  return reported.splice(0);
}

const foreignWrites: string[] = [];

// Every statement that wrote into a transaction another chain had open, since
// the last drain (sqlite-connection.ts `watchForForeignWrites`).
export function reportForeignWrite(statement: string): void {
  keepRecent(foreignWrites, statement);
  console.error(`[db] a write landed inside another operation's open transaction and will be lost if it rolls back: ${statement}`);
}

export function drainForeignWrites(): string[] {
  return foreignWrites.splice(0);
}
