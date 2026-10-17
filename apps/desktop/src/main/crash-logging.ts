import { app } from "electron";
import { handleGuarded } from "./ipc-guard.js";
import {
  MEZAN_LOG_RENDERER_ERROR_CHANNEL,
  RendererErrorSource,
  type RendererErrorReport,
} from "../shared/ipc-contract.js";
import { LogEvent, LogLevel, type FileLogger } from "./log.js";

const MAX_MESSAGE = 2000;
const MAX_STACK = 4000;
const MAX_SHORT = 500;
const RENDERER_REPORTS_PER_MINUTE = 30;

const SOURCES: ReadonlySet<string> = new Set(Object.values(RendererErrorSource));

function clip(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value !== "" ? value.slice(0, max) : undefined;
}

export function sanitiseRendererReport(raw: unknown): RendererErrorReport | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const message = clip(r["message"], MAX_MESSAGE);
  if (!message) return null;
  const source =
    typeof r["source"] === "string" && SOURCES.has(r["source"])
      ? (r["source"] as RendererErrorSource)
      : RendererErrorSource.Error;
  return {
    source,
    message,
    stack: clip(r["stack"], MAX_STACK),
    route: clip(r["route"], MAX_SHORT),
  };
}

export function createReportLimiter(perMinute: number, now: () => number = Date.now): () => boolean {
  let windowStart = 0;
  let count = 0;
  return () => {
    const t = now();
    if (t - windowStart >= 60_000) {
      windowStart = t;
      count = 0;
    }
    count += 1;
    return count <= perMinute;
  };
}

export function registerCrashLogging(getLog: () => FileLogger): void {
  const safely = (fn: (log: FileLogger) => void): void => {
    try {
      fn(getLog());
    } catch {
      // Logging a crash must never be a second crash.
    }
  };

  /*
   * POLICY: neither handler exits. The LAN host serves every till in the shop
   * out of this process, so a single refused posting (or a stray throw in a
   * timer) must not end it for all of them; the failure is written down with
   * its stack instead. Registering `uncaughtException` also suppresses
   * Electron's default error dialog, which is why the line goes to the file.
   */
  process.on("unhandledRejection", (reason) => {
    safely((log) =>
      log.event(LogLevel.Error, LogEvent.UnhandledRejection, { reason }, "unhandled rejection (ignored, host stays up)"),
    );
  });
  process.on("uncaughtException", (error, origin) => {
    safely((log) => log.event(LogLevel.Fatal, LogEvent.UncaughtException, { error, origin }, "uncaught exception"));
  });

  app.on("render-process-gone", (_event, contents, details) => {
    safely((log) =>
      log.event(LogLevel.Error, LogEvent.RenderProcessGone, {
        reason: details.reason,
        exitCode: details.exitCode,
        url: contents.getURL(),
      }),
    );
  });
  app.on("child-process-gone", (_event, details) => {
    safely((log) =>
      log.event(LogLevel.Error, LogEvent.ChildProcessGone, {
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        serviceName: details.serviceName,
        name: details.name,
      }),
    );
  });

  const allow = createReportLimiter(RENDERER_REPORTS_PER_MINUTE);
  handleGuarded(MEZAN_LOG_RENDERER_ERROR_CHANNEL, (_event, raw: unknown): void => {
    const report = sanitiseRendererReport(raw);
    if (!report || !allow()) return;
    safely((log) =>
      log.event(
        LogLevel.Error,
        LogEvent.RendererError,
        { source: report.source, stack: report.stack, route: report.route },
        report.message,
      ),
    );
  });
}
