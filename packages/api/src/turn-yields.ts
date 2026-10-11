import { keepRecent } from "@mezan/persistence";

const reported: string[] = [];

// What the process was waiting on when the holder gave the loop back, by Node's
// own resource names (ScryptJob, TCPSocketWrap, ProcessWrap, Timeout, …): the
// route alone says who, this says for what.
function pendingWork(): string {
  const waitingOn = new Set(process.getActiveResourcesInfo());
  waitingOn.delete("Immediate");
  return [...waitingOn].sort().join("+") || "nothing left pending";
}

// Every holder that gave the event loop back while holding a tenant's
// connection, since the last drain. The test suites and the seed drives assert
// it stays empty: a route that awaits a socket, a child process or a hash under
// the turn fails them by name.
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
