import { appendFileSync, chmodSync, closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import {
  createMemorySecurityEventFallback,
  UNRECORDED_RECENT_LIMIT,
  type SecurityEventFallback,
  type UnrecordedSecurityEvent,
} from "@mezan/domain";
import type { SqliteConnectionInput } from "./sqlite-connection.js";

const DEFAULT_MAX_BYTES = 1_048_576;
const DEFAULT_LOCK_WAIT_MS = 500;
const DEFAULT_LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 5;
const OWNER_ONLY = 0o600;
const FILE_SUFFIX = ".security-fallback.jsonl";

export interface FileSecurityEventFallbackOptions {
  readonly file: string;
  readonly maxBytes?: number;
  readonly lockWaitMs?: number;
  readonly lockStaleMs?: number;
}

interface RotationMarker {
  readonly rotated: { readonly dropped: number; readonly droppedTotal: number; readonly at: string };
}

interface ReadFile {
  readonly events: UnrecordedSecurityEvent[];
  readonly corrupted: number;
  readonly droppedTotal: number | null;
}

function isRotationMarker(value: unknown): value is RotationMarker {
  if (typeof value !== "object" || value === null || !("rotated" in value)) return false;
  const rotated = (value as { rotated: unknown }).rotated;
  return typeof rotated === "object" && rotated !== null && typeof (rotated as { droppedTotal?: unknown }).droppedTotal === "number";
}

function isEvent(value: unknown): value is UnrecordedSecurityEvent {
  return typeof value === "object" && value !== null && typeof (value as { at?: unknown }).at === "string" && typeof (value as { action?: unknown }).action === "string";
}

function read(file: string): ReadFile {
  const events: UnrecordedSecurityEvent[] = [];
  let corrupted = 0;
  let droppedTotal: number | null = null;
  if (!existsSync(file)) return { events, corrupted, droppedTotal };
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      corrupted += 1;
      continue;
    }
    if (isRotationMarker(parsed)) droppedTotal = parsed.rotated.droppedTotal;
    else if (isEvent(parsed)) events.push(parsed);
    else corrupted += 1;
  }
  return { events, corrupted, droppedTotal };
}

function busyWait(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function createFileSecurityEventFallback(options: FileSecurityEventFallbackOptions): SecurityEventFallback {
  const { file } = options;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lockWaitMs = options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;
  const lockStaleMs = options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS;
  const previous = `${file}.1`;
  const counter = `${file}.count`;
  const lock = `${file}.lock`;

  function ownerOnly(target: string): void {
    try {
      chmodSync(target, OWNER_ONLY);
    } catch {
      return;
    }
  }

  // REQUIRED: one writer at a time. Two processes appending and rotating the
  // same pair of files would each rename the other's current file away.
  function exclusively<T>(work: () => T): T {
    const giveUpAt = Date.now() + lockWaitMs;
    for (;;) {
      try {
        closeSync(openSync(lock, "wx", OWNER_ONLY));
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        const heldSince = statSync(lock, { throwIfNoEntry: false })?.mtimeMs;
        if (heldSince === undefined) continue;
        if (Date.now() - heldSince >= lockStaleMs) {
          rmSync(lock, { force: true });
          continue;
        }
        if (Date.now() >= giveUpAt) throw new Error(`the security fallback file "${file}" is held by another writer`);
        busyWait(LOCK_RETRY_MS);
      }
    }
    try {
      return work();
    } finally {
      rmSync(lock, { force: true });
    }
  }

  // The lines are the record; the counter file is a copy of what they add up
  // to and is rewritten whenever it disagrees with them.
  function tally(): { readonly current: ReadFile; readonly older: ReadFile; readonly dropped: number; readonly count: number; readonly corrupted: number } {
    const current = read(file);
    const older = read(previous);
    const dropped = current.droppedTotal ?? older.droppedTotal ?? 0;
    const corrupted = current.corrupted + older.corrupted;
    return { current, older, dropped, corrupted, count: dropped + current.events.length + older.events.length + corrupted };
  }

  function writeCounter(count: number): void {
    writeFileSync(counter, String(count), { encoding: "utf8", mode: OWNER_ONLY });
    ownerOnly(counter);
  }

  return {
    record(entry) {
      exclusively(() => {
        const line = `${JSON.stringify(entry)}\n`;
        const before = tally();
        const size = existsSync(file) ? statSync(file).size : 0;
        if (size > 0 && size + Buffer.byteLength(line) > maxBytes) {
          const lost = before.older.events.length + before.older.corrupted;
          renameSync(file, previous);
          const marker: RotationMarker = { rotated: { dropped: lost, droppedTotal: before.dropped + lost, at: entry.at } };
          writeFileSync(file, `${JSON.stringify(marker)}\n`, { encoding: "utf8", mode: OWNER_ONLY });
          ownerOnly(file);
        }
        const created = !existsSync(file);
        appendFileSync(file, line, { encoding: "utf8", mode: OWNER_ONLY });
        if (created) ownerOnly(file);
        writeCounter(before.count + 1);
      });
    },
    summary(limit = UNRECORDED_RECENT_LIMIT) {
      const { current, older, dropped, corrupted, count } = tally();
      const recent = [...older.events, ...current.events].slice(-limit).reverse();
      return { count, recent, dropped, corrupted };
    },
  };
}

export function securityFallbackFor(database: SqliteConnectionInput | undefined): SecurityEventFallback {
  if (typeof database !== "string" || database === "" || database === ":memory:" || database.startsWith("file:")) {
    return createMemorySecurityEventFallback();
  }
  return createFileSecurityEventFallback({ file: `${database}${FILE_SUFFIX}` });
}
