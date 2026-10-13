import type { Context } from "hono";

export enum SessionEnded {
  Displaced = "displaced",
}

export const SESSION_ENDED_HEADER = "x-mezan-session-ended";

const displaced = new WeakSet<Context>();

export function markSessionDisplaced(c: Context): void {
  displaced.add(c);
}

export function sessionWasDisplaced(c: Context): boolean {
  return displaced.has(c);
}
