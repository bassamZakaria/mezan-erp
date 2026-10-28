import { AsyncLocalStorage } from "node:async_hooks";
import { pino, type DestinationStream, type Logger } from "pino";

export type { Logger } from "pino";

export enum LogEvent {
  RequestCompleted = "http.request.completed",
  RequestFailed = "http.request.failed",
  UnhandledError = "http.unhandled_error",
  JobSucceeded = "job.succeeded",
  JobFailed = "job.failed",
  ProcessStarted = "process.started",
  ProcessStopping = "process.stopping",
  ProcessUncaughtException = "process.uncaught_exception",
  ProcessUnhandledRejection = "process.unhandled_rejection",
  ProcessUncleanRestart = "process.unclean_restart",
  ReadinessFailed = "readiness.failed",
  AlertSent = "alert.sent",
  AlertUnsent = "alert.unsent",
  ClientErrorReported = "client_error.reported",
  OwnerPasswordGenerated = "platform.owner_password_generated",
  BackgroundTaskFailed = "background.task_failed",
  ConfigurationWarning = "config.warning",
  ServiceNotice = "service.notice",
}

export enum LogLevel {
  Fatal = "fatal",
  Error = "error",
  Warn = "warn",
  Info = "info",
  Debug = "debug",
  Silent = "silent",
}

const PINO_ERROR_LEVEL = 50;

export interface RequestContext {
  readonly requestId: string;
  tenantId?: string;
  userId?: string;
  method?: string;
  path?: string;
}

const requestContexts = new AsyncLocalStorage<RequestContext>();

export function currentRequestContext(): RequestContext | undefined {
  return requestContexts.getStore();
}

export function runWithRequestContext<T>(context: RequestContext, work: () => T): T {
  return requestContexts.run(context, work);
}

export function annotateRequest(fields: { readonly tenantId?: string; readonly userId?: string }): void {
  const context = requestContexts.getStore();
  if (!context) return;
  if (fields.tenantId !== undefined) context.tenantId = fields.tenantId;
  if (fields.userId !== undefined) context.userId = fields.userId;
}

// SECURITY: redaction happens HERE, at the logger, so no call site has to remember it. Pino's `*`
// matches one level only, so each key is listed at the top level and two levels down.
const REDACTED_KEYS = [
  "pin",
  "newPin",
  "currentPin",
  "password",
  "newPassword",
  "currentPassword",
  "passphrase",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "authorization",
  "cookie",
  "iban",
  "email",
  "ownerEmail",
  "successorEmail",
  "secret",
  "deviceSecret",
  "signingSecret",
  "hmacSecret",
  "secretKey",
];

export const REDACTED_PATHS: readonly string[] = REDACTED_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);

export interface ErrorLogEntry {
  readonly event: string | null;
  readonly component: string | null;
}

type ErrorLogListener = (entry: ErrorLogEntry) => void;
const errorListeners = new Set<ErrorLogListener>();

export function onErrorLogged(listener: ErrorLogListener): () => void {
  errorListeners.add(listener);
  return () => errorListeners.delete(listener);
}

function notifyErrorListeners(args: unknown[], bindings: Record<string, unknown>): void {
  if (errorListeners.size === 0) return;
  const first = args[0];
  const event = first && typeof first === "object" && "event" in first ? String((first as { event: unknown }).event) : null;
  const component = typeof bindings["component"] === "string" ? (bindings["component"] as string) : null;
  for (const listener of errorListeners) {
    try {
      listener({ event, component });
    } catch {
      // INVARIANT: an alert listener that throws must never break the log call that fed it.
    }
  }
}

const CONSOLE_LEVEL = /"level":"(fatal|error|warn)"/;

// Under the test runner every line goes through `console`, so the suites that spy on console
// keep observing what the code reports; everywhere else it is one synchronous JSON line on stdout.
function consoleDestination(): DestinationStream {
  return {
    write(line: string) {
      const text = line.endsWith("\n") ? line.slice(0, -1) : line;
      const level = CONSOLE_LEVEL.exec(text)?.[1];
      if (level === "fatal" || level === "error") console.error(text);
      else if (level === "warn") console.warn(text);
      else console.log(text);
    },
  };
}

function destination(): DestinationStream {
  if (process.env["VITEST"]) return consoleDestination();
  return pino.destination({ dest: process.env["MEZAN_LOG_STDERR"] === "1" ? 2 : 1, sync: true });
}

function levelFromEnv(): string {
  const configured = process.env["MEZAN_LOG_LEVEL"]?.trim().toLowerCase();
  const known = Object.values(LogLevel) as string[];
  return configured && known.includes(configured) ? configured : LogLevel.Info;
}

function contextFields(): Record<string, string> {
  const context = requestContexts.getStore();
  if (!context) return {};
  const fields: Record<string, string> = { requestId: context.requestId };
  if (context.tenantId) fields["tenantId"] = context.tenantId;
  if (context.userId) fields["userId"] = context.userId;
  if (context.path) fields["route"] = context.path;
  return fields;
}

export const logger: Logger = pino(
  {
    level: levelFromEnv(),
    base: {
      service: process.env["MEZAN_SERVICE_NAME"] ?? "mezan",
      version: process.env["MEZAN_VERSION"] ?? process.env["npm_package_version"] ?? "dev",
      env: process.env["MEZAN_ENV"] ?? process.env["NODE_ENV"] ?? "development",
    },
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: [...REDACTED_PATHS], censor: "[redacted]" },
    mixin: contextFields,
    hooks: {
      logMethod(args, method, level) {
        if (level >= PINO_ERROR_LEVEL) notifyErrorListeners(args, this.bindings());
        return method.apply(this, args);
      },
    },
  },
  destination(),
);

export function createLogger(component: string, bindings: Record<string, string> = {}): Logger {
  return logger.child({ component, ...bindings });
}

/**
 * The fields of an error that are safe to log when its MESSAGE may carry personal data (an
 * address echoed by an SMTP server, a validation message quoting the input): the class name and
 * the code only, never the message or the stack.
 */
export function errorIdentity(err: unknown): { readonly errName: string; readonly errCode?: string } {
  if (!(err instanceof Error)) return { errName: typeof err };
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? { errName: err.name, errCode: code } : { errName: err.name };
}

export function flushLogs(): void {
  logger.flush();
}
