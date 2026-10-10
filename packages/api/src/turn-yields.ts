const reported: string[] = [];

// Every handler that gave the event loop back while holding a tenant's
// connection, since the last drain. The test suites and the seed drives assert
// it stays empty: a route that awaits a socket, a child process or a hash under
// the turn fails them by name.
export function reportTurnYield(route: string): void {
  reported.push(route);
}

export function drainTurnYields(): string[] {
  return reported.splice(0);
}
