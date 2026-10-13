import { keepRecent } from "../../persistence/src/untransacted-audits.js";

const reported: string[] = [];

function pendingWork(): string {
  const waitingOn = new Set(process.getActiveResourcesInfo());
  waitingOn.delete("Immediate");
  return [...waitingOn].sort().join("+") || "nothing left pending";
}

export function reportTurnYield(route: string): void {
  const waitingOn = pendingWork();
  keepRecent(reported, `${route} [${waitingOn}]`);
  console.error(
    `[db] ${route} gave the event loop back while holding the tenant's connection (waiting on ${waitingOn}); ` +
      "do that work before the turn, or through a port that hands the turn back (AuditSink.outsideTurn)",
  );
}

export function drainTurnYields(): string[] {
  return reported.splice(0);
}
