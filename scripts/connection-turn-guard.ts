import { drainTurnYields } from "../packages/api/src/turn-yields.js";
import { drainForeignWrites, drainUntransactedAudits } from "../packages/persistence/src/untransacted-audits.js";

function tally(reports: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const report of reports) counts.set(report, (counts.get(report) ?? 0) + 1);
  return [...counts].sort().map(([report, count]) => `${report} ×${count}`);
}

export function connectionTurnFindings(): string[] {
  return [
    ...tally(drainTurnYields()).map((line) => `held the connection across outside work: ${line}`),
    ...tally(drainUntransactedAudits()).map((line) => `change-log event outside any transaction: ${line}`),
    ...tally(drainForeignWrites()).map((line) => `write inside another operation's open transaction: ${line}`),
  ];
}
