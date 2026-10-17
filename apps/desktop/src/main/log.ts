import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { redactText, redactValue } from "./redact.js";

/**
 * A LOG FILE, because `console.error` on a double-clicked app goes nowhere.
 *
 * Every startup failure this product can have — no OS keyring, a damaged
 * `client.json`, an encrypted database it cannot open, a licence it cannot
 * verify — was written to a console that a shop owner launching from the Dock
 * or the Start menu never sees, and then the process exited. The support call
 * that follows is «البرنامج لا يفتح», with nothing on either end of the phone
 * to go on.
 *
 * One JSON object per line (`ts`, `level`, `event`, `message`, `fields`). Every
 * string and every field passes through the redactor BEFORE it is written, so
 * the file is safe to attach to a support ticket without being read first.
 */

/** Rotate at 1 MB, keeping one previous file. Two files is enough to read back. */
const MAX_BYTES = 1_000_000;

export enum LogLevel {
  Debug = "debug",
  Info = "info",
  Warn = "warn",
  Error = "error",
  Fatal = "fatal",
}

export enum LogEvent {
  Message = "desktop.message",
  Fatal = "desktop.fatal",
  UnhandledRejection = "main.unhandled_rejection",
  UncaughtException = "main.uncaught_exception",
  RenderProcessGone = "app.render_process_gone",
  ChildProcessGone = "app.child_process_gone",
  RendererError = "renderer.error",
  WorkerOutput = "backend.worker_output",
  SupportLogsSaved = "support.logs_saved",
}

export type LogFields = Readonly<Record<string, unknown>>;

export interface FileLogger {
  (message: string): void;
  readonly filePath: string;
  event(level: LogLevel, event: LogEvent | string, fields?: LogFields, message?: string): void;
  tail(maxLines: number): readonly string[];
}

const TAGGED = /^\[([a-z0-9_.-]+)\]\s*/i;

function classify(message: string): { level: LogLevel; event: string; text: string } {
  if (message.startsWith("FATAL ")) {
    return { level: LogLevel.Fatal, event: LogEvent.Fatal, text: message.slice(6) };
  }
  const tag = TAGGED.exec(message);
  const event = tag ? `desktop.${tag[1]!.toLowerCase()}` : LogEvent.Message;
  const text = tag ? message.slice(tag[0].length) : message;
  const level = /\b(fail|failed|could not|cannot|error|refused|REVOKED)\b/i.test(text)
    ? LogLevel.Warn
    : LogLevel.Info;
  return { level, event, text };
}

export function createFileLogger(logsDir: string, fileName = "mezan.log"): FileLogger {
  const filePath = path.join(logsDir, fileName);
  const previous = path.join(logsDir, `${path.parse(fileName).name}.1.log`);

  const append = (line: string): void => {
    try {
      mkdirSync(logsDir, { recursive: true });
      try {
        if (statSync(filePath).size > MAX_BYTES) renameSync(filePath, previous);
      } catch {
        // No file yet, or the rename raced another process. Append anyway.
      }
      appendFileSync(filePath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
    } catch {
      // A log write must NEVER be the reason the app fails to start.
    }
  };

  const mirror = (level: LogLevel, line: string): void => {
    if (level === LogLevel.Error || level === LogLevel.Fatal) console.error(line);
    else console.log(line);
  };

  const event = (level: LogLevel, name: LogEvent | string, fields?: LogFields, message?: string): void => {
    const record: Record<string, unknown> = { ts: new Date().toISOString(), level, event: name };
    if (message !== undefined) record["message"] = redactText(message);
    if (fields && Object.keys(fields).length > 0) record["fields"] = redactValue(fields);
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({ ts: record["ts"], level, event: name, message: "[unserialisable log record]" });
    }
    append(line);
    mirror(level, line);
  };

  const write = (message: string): void => {
    const { level, event: name, text } = classify(message);
    event(level, name, undefined, text);
  };

  const tail = (maxLines: number): readonly string[] => {
    const lines: string[] = [];
    for (const file of [previous, filePath]) {
      try {
        lines.push(
          ...readFileSync(file, "utf8")
            .split("\n")
            .filter((l) => l !== ""),
        );
      } catch {
        // Absent file: nothing logged there yet.
      }
    }
    return lines.slice(-maxLines).map(redactText);
  };

  return Object.assign(write, { filePath, event, tail });
}

export interface LineSplitter {
  push(chunk: Buffer | string): void;
  flush(): void;
}

export function createLineSplitter(onLine: (line: string) => void): LineSplitter {
  let pending = "";
  return {
    push(chunk) {
      pending += chunk.toString();
      const parts = pending.split(/\r?\n/);
      pending = parts.pop() ?? "";
      for (const part of parts) if (part.trim() !== "") onLine(part);
    },
    flush() {
      if (pending.trim() !== "") onLine(pending);
      pending = "";
    },
  };
}
