import { ClientErrorKindDTO, ClientErrorPlatformDTO, type ClientErrorReportDTO } from "@mezan/contracts";
import type { Transport } from "../data/transport";

export const CLIENT_ERRORS_PATH = "/client-errors";

export type ClientErrorSend = (report: ClientErrorReportDTO) => Promise<void>;

export interface ClientErrorReporterOptions {
  readonly send: ClientErrorSend;
  readonly platform?: ClientErrorPlatformDTO;
  readonly appVersion?: string | null;
  readonly target?: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly routeOf?: () => string;
  readonly now?: () => number;
}

export interface ClientErrorContext {
  readonly route?: string;
  readonly requestId?: string | null;
}

const REPEAT_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_PAGE = 20;
const STACK_LINES = 30;

interface ActiveReporter {
  report(kind: ClientErrorKindDTO, error: unknown, context?: ClientErrorContext): void;
}

let active: ActiveReporter | null = null;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function stackOf(error: unknown): string | null {
  if (!(error instanceof Error) || !error.stack) return null;
  return error.stack.split("\n").slice(0, STACK_LINES).join("\n");
}

function requestIdOf(error: unknown): string | null {
  const id = error && typeof error === "object" ? (error as { requestId?: unknown }).requestId : undefined;
  return typeof id === "string" ? id : null;
}

function defaultPlatform(): ClientErrorPlatformDTO {
  return (globalThis as { mezan?: unknown }).mezan ? ClientErrorPlatformDTO.Desktop : ClientErrorPlatformDTO.Web;
}

function defaultRoute(): string {
  return typeof location === "undefined" ? "" : location.pathname;
}

/** Sends a report through any {@link Transport} — the web build's HTTP one, or the desktop's IPC bridge. */
export function transportSender(transport: Transport, headers: () => Record<string, string> = () => ({})): ClientErrorSend {
  return async (report) => {
    await transport(CLIENT_ERRORS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers() },
      body: JSON.stringify(report),
    });
  };
}

/**
 * Reports what crashes in the client to `POST /client-errors`: the route error boundary calls
 * {@link reportClientError}, and the window's `error` / `unhandledrejection` events are caught
 * here. SECURITY: a report carries the error's message and stack, the route and the app version —
 * never form values, query strings or storage. The same message is sent at most once a minute and
 * a page sends at most twenty, so a render loop cannot flood the server. Reporting never throws.
 */
export function installClientErrorReporter(options: ClientErrorReporterOptions): () => void {
  const now = options.now ?? Date.now;
  const platform = options.platform ?? defaultPlatform();
  const routeOf = options.routeOf ?? defaultRoute;
  const lastSent = new Map<string, number>();
  let sent = 0;

  const reporter: ActiveReporter = {
    report(kind, error, context = {}) {
      try {
        const message = messageOf(error);
        if (message === "") return;
        const stack = stackOf(error);
        const fingerprint = `${kind}|${message}|${stack?.split("\n")[1] ?? ""}`;
        const at = now();
        const previous = lastSent.get(fingerprint);
        if ((previous !== undefined && at - previous < REPEAT_WINDOW_MS) || sent >= MAX_REPORTS_PER_PAGE) return;
        lastSent.set(fingerprint, at);
        sent += 1;
        void options
          .send({
            platform,
            kind,
            message,
            stack,
            route: context.route ?? routeOf(),
            appVersion: options.appVersion ?? null,
            userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
            requestId: context.requestId ?? requestIdOf(error),
          })
          .catch(() => undefined);
      } catch {
        // INVARIANT: the error reporter must never become a second error.
      }
    },
  };

  const onError = (event: Event) => {
    const errorEvent = event as ErrorEvent;
    reporter.report(ClientErrorKindDTO.WindowError, errorEvent.error ?? errorEvent.message);
  };
  const onRejection = (event: Event) => {
    reporter.report(ClientErrorKindDTO.UnhandledRejection, (event as PromiseRejectionEvent).reason);
  };
  const target = options.target ?? (typeof window === "undefined" ? undefined : window);
  target?.addEventListener("error", onError);
  target?.addEventListener("unhandledrejection", onRejection);
  active = reporter;

  return () => {
    target?.removeEventListener("error", onError);
    target?.removeEventListener("unhandledrejection", onRejection);
    if (active === reporter) active = null;
  };
}

export function reportClientError(kind: ClientErrorKindDTO, error: unknown, context?: ClientErrorContext): void {
  active?.report(kind, error, context);
}
