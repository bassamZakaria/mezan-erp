const MOST_RECENT = 200;

export function keepRecent(reports: string[], report: string): void {
  reports.push(report);
  if (reports.length > MOST_RECENT) reports.splice(0, reports.length - MOST_RECENT);
}

const reported: string[] = [];

export function reportUntransactedAudit(event: string): void {
  keepRecent(reported, event);
  console.error(`[audit] ${event} was appended outside any transaction, so the write it records can commit or roll back without it`);
}

export function drainUntransactedAudits(): string[] {
  return reported.splice(0);
}

const foreignWrites: string[] = [];

export function reportForeignWrite(statement: string): void {
  keepRecent(foreignWrites, statement);
  console.error(`[db] a write landed inside another operation's open transaction and will be lost if it rolls back: ${statement}`);
}

export function drainForeignWrites(): string[] {
  return foreignWrites.splice(0);
}
