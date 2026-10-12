import { appendFileSync, chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import {
  createMemorySecurityEventFallback,
  UNRECORDED_RECENT_LIMIT,
  type SecurityEventFallback,
  type UnrecordedSecurityEvent,
} from "@mezan/domain";
import type { SqliteConnectionInput } from "./sqlite-connection.js";

const DEFAULT_MAX_BYTES = 1_048_576;
const FILE_SUFFIX = ".security-fallback.jsonl";

export interface FileSecurityEventFallbackOptions {
  readonly file: string;
  readonly maxBytes?: number;
}

function linesOf(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((line) => line !== "");
}

function parsed(line: string): UnrecordedSecurityEvent | null {
  try {
    return JSON.parse(line) as UnrecordedSecurityEvent;
  } catch {
    return null;
  }
}

export function createFileSecurityEventFallback(options: FileSecurityEventFallbackOptions): SecurityEventFallback {
  const { file } = options;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const previous = `${file}.1`;
  const counter = `${file}.count`;

  function readCount(): number {
    if (existsSync(counter)) {
      const stored = Number.parseInt(readFileSync(counter, "utf8"), 10);
      if (Number.isSafeInteger(stored) && stored >= 0) return stored;
    }
    return linesOf(previous).length + linesOf(file).length;
  }

  function ownerOnly(target: string): void {
    try {
      chmodSync(target, 0o600);
    } catch {
      return;
    }
  }

  return {
    record(entry) {
      const line = `${JSON.stringify(entry)}\n`;
      const before = readCount();
      const size = existsSync(file) ? statSync(file).size : 0;
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) renameSync(file, previous);
      const created = !existsSync(file);
      appendFileSync(file, line, { encoding: "utf8", mode: 0o600 });
      if (created) ownerOnly(file);
      writeFileSync(counter, String(before + 1), { encoding: "utf8", mode: 0o600 });
    },
    summary(limit = UNRECORDED_RECENT_LIMIT) {
      const lines = linesOf(file);
      const tail = lines.length >= limit ? lines.slice(-limit) : [...linesOf(previous), ...lines].slice(-limit);
      const recent = tail.map(parsed).filter((entry): entry is UnrecordedSecurityEvent => entry !== null).reverse();
      return { count: readCount(), recent };
    },
  };
}

export function securityFallbackFor(database: SqliteConnectionInput | undefined): SecurityEventFallback {
  if (typeof database !== "string" || database === "" || database === ":memory:" || database.startsWith("file:")) {
    return createMemorySecurityEventFallback();
  }
  return createFileSecurityEventFallback({ file: `${database}${FILE_SUFFIX}` });
}
