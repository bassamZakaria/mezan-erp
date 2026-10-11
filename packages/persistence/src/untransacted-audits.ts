const reported: string[] = [];

// Every change-log event appended by a mutating request OUTSIDE any
// transaction, since the last drain: the event and the write it records could
// then part company — one committed, the other lost. The test suites and the
// seed drives assert this stays empty, whichever writer made the append and
// whichever package it lives in.
export function reportUntransactedAudit(event: string): void {
  reported.push(event);
}

export function drainUntransactedAudits(): string[] {
  return reported.splice(0);
}
