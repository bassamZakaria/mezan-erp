import { drainTurnYields } from "../packages/api/src/turn-yields.js";
import { drainUntransactedAudits } from "../packages/persistence/src/untransacted-audits.js";

function tally(reports: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const report of reports) counts.set(report, (counts.get(report) ?? 0) + 1);
  return [...counts].sort().map(([report, count]) => `${report} ×${count}`);
}

/**
 * What a seed drive saw go wrong on the tenant's connection, as lines to
 * print: a handler that awaited the outside world while holding the turn, and
 * a change-log event appended outside any transaction. Empty when neither did.
 */
export function connectionTurnFindings(): string[] {
  return [
    ...tally(drainTurnYields()).map((line) => `held the connection across outside work: ${line}`),
    ...tally(drainUntransactedAudits()).map((line) => `change-log event outside any transaction: ${line}`),
  ];
}
