import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { backfillErrorMessage } from "./error-message-backfill.js";
import { LogEvent, createLogger, currentRequestContext, runWithRequestContext, type RequestContext } from "./logger.js";

export const REQUEST_ID_HEADER = "x-request-id";

const INBOUND_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const SERVER_ERROR_FROM = 500;
const CLIENT_ERROR_FROM = 400;
const SERVICE_UNAVAILABLE = 503;

const log = createLogger("http");

export interface RequestLoggingOptions {
  readonly isQuiet?: (path: string) => boolean;
}

function requestIdFrom(header: string | undefined): string {
  return header !== undefined && INBOUND_REQUEST_ID.test(header) ? header : randomUUID();
}

async function shapeErrorBody(response: Response, requestId: string): Promise<Response> {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) return response;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return response;
  const status = response.status;
  const withId = status >= SERVER_ERROR_FROM && status !== SERVICE_UNAVAILABLE;
  const backfilled = backfillErrorMessage(body as Record<string, unknown>, status);
  if (!withId && !backfilled) return response;
  const shaped = { ...(backfilled ?? (body as Record<string, unknown>)), ...(withId ? { requestId } : {}) };
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(shaped), { status, statusText: response.statusText, headers });
}

/**
 * One request id per request, end to end. The OUTERMOST mount mints it (or adopts a well-formed
 * `x-request-id` from the edge), every log line written while the request runs carries it, the
 * response returns it as a header, and every unexpected 5xx JSON body names it so the error screen
 * can show it. Every 4xx/5xx JSON body without a sentence gets one in Arabic and English. A 503 is left as it is: here it is a coded, retryable refusal (a busy connection,
 * books that are refused), not a fault to report. A nested app (the tenant router forwarding into a tenant backend) finds the context already
 * set and only passes through.
 */
export function requestLogging(options: RequestLoggingOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    if (currentRequestContext()) return next();
    const context: RequestContext = { requestId: requestIdFrom(c.req.header(REQUEST_ID_HEADER)), method: c.req.method, path: c.req.path };
    const started = performance.now();
    await runWithRequestContext(context, () => next());
    const status = c.res.status;
    if (status >= CLIENT_ERROR_FROM) c.res = await shapeErrorBody(c.res, context.requestId);
    c.res.headers.set(REQUEST_ID_HEADER, context.requestId);
    const fields = {
      event: status >= SERVER_ERROR_FROM ? LogEvent.RequestFailed : LogEvent.RequestCompleted,
      method: context.method,
      route: context.path,
      status,
      durationMs: Math.round(performance.now() - started),
      requestId: context.requestId,
      ...(context.tenantId ? { tenantId: context.tenantId } : {}),
      ...(context.userId ? { userId: context.userId } : {}),
    };
    if (status === SERVICE_UNAVAILABLE) log.warn(fields, "request refused as unavailable");
    else if (status >= SERVER_ERROR_FROM) log.error(fields, "request failed");
    else if (options.isQuiet?.(context.path ?? "") && status < CLIENT_ERROR_FROM) log.debug(fields, "request completed");
    else log.info(fields, "request completed");
  };
}
