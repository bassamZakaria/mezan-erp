import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { clientErrorReportSchema } from "@mezan/contracts";
import { LogEvent, createLogger } from "./observability/index.js";
import type { AuthContextResolver } from "./permission-gate.js";
import { requestOrigin } from "./request-origin.js";

export const CLIENT_ERROR_BODY_BYTES = 16 * 1024;
export const CLIENT_ERRORS_PER_WINDOW = 20;
export const CLIENT_ERROR_WINDOW_MS = 10 * 60_000;
const TRACKED_CALLERS = 2_000;
const IN_PROCESS_CALLER = "in-process";

export enum ClientErrorRefusal {
  Invalid = "CLIENT_ERROR_INVALID",
  TooMany = "CLIENT_ERROR_RATE_LIMITED",
  TooLarge = "CLIENT_ERROR_TOO_LARGE",
}

export interface ClientErrorSink {
  record(error: {
    readonly id: string;
    readonly receivedAt: string;
    readonly platform: string;
    readonly kind: string;
    readonly message: string;
    readonly stack: string | null;
    readonly route: string | null;
    readonly appVersion: string | null;
    readonly userAgent: string | null;
    readonly requestId: string | null;
    readonly userId: string | null;
  }): Promise<void>;
}

export interface ClientErrorRoutesDeps {
  readonly sink: ClientErrorSink;
  readonly resolveAuthContext: AuthContextResolver;
  readonly now?: () => Date;
}

const log = createLogger("client-errors");

function createWindowCounter(now: () => number) {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return (key: string): boolean => {
    const at = now();
    const window = windows.get(key);
    if (!window || at - window.startedAt >= CLIENT_ERROR_WINDOW_MS) {
      if (windows.size >= TRACKED_CALLERS) windows.delete(windows.keys().next().value!);
      windows.set(key, { startedAt: at, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= CLIENT_ERRORS_PER_WINDOW;
  };
}

/**
 * `POST /client-errors` — what a client reports when it crashed. Open without a session (the
 * login screen can crash too), so it is held to a small body, a per-caller window and a capped
 * table. SECURITY: it stores only the report's own fields — message, trimmed stack, route, app
 * version, user agent, request id — and never echoes them back; the session, when there is one,
 * contributes only the user id.
 */
export function createClientErrorRoutes(deps: ClientErrorRoutesDeps) {
  const now = deps.now ?? (() => new Date());
  const allowCaller = createWindowCounter(() => now().getTime());
  const allowUser = createWindowCounter(() => now().getTime());
  const app = new Hono();

  app.post(
    "/",
    bodyLimit({
      maxSize: CLIENT_ERROR_BODY_BYTES,
      onError: (c) => c.json({ error: ClientErrorRefusal.TooLarge, message: "تقرير الخطأ أكبر من المسموح به.", messageEn: "The error report is too large." }, 413),
    }),
    async (c) => {
      const auth = await deps.resolveAuthContext(c);
      const userId = auth.authenticated ? auth.userId : null;
      const caller = requestOrigin(c) ?? IN_PROCESS_CALLER;
      if (!allowCaller(caller) || (userId !== null && !allowUser(userId))) {
        return c.json({ error: ClientErrorRefusal.TooMany, message: "أُرسلت تقارير أخطاء كثيرة؛ ستُقبل لاحقاً.", messageEn: "Too many error reports; try later." }, 429);
      }
      const parsed = clientErrorReportSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json({ error: ClientErrorRefusal.Invalid, message: "تقرير الخطأ غير صالح.", messageEn: "The error report is not valid." }, 400);
      }
      const report = parsed.data;
      const id = randomUUID();
      await deps.sink.record({
        id,
        receivedAt: now().toISOString(),
        platform: report.platform,
        kind: report.kind,
        message: report.message,
        stack: report.stack ?? null,
        route: report.route ?? null,
        appVersion: report.appVersion ?? null,
        userAgent: report.userAgent ?? null,
        requestId: report.requestId ?? null,
        userId,
      });
      log.warn(
        { event: LogEvent.ClientErrorReported, clientErrorId: id, platform: report.platform, kind: report.kind, clientRoute: report.route ?? null, failedRequestId: report.requestId ?? null },
        "a client reported an error",
      );
      return c.json({ id }, 201);
    },
  );

  return app;
}
