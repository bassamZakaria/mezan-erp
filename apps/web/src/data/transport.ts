/**
 * The transport is the ONE place the web app decides how to reach the shared
 * Hono app: over HTTP (dev/web, via the `/api` Vite middleware or apps/server)
 * or over the Electron IPC bridge (`window.mezan.fetch` → `app.fetch`). Every
 * data hook goes through a `Transport`, so nothing above this file branches on
 * platform, and tests inject a fake transport.
 */

export interface TransportResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly retryAfterSeconds?: number | null;
  readonly sessionEnded?: string | null;
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
  blob?(): Promise<Blob>;
  header?(name: string): string | null;
  /** Where a `saveAs` request's body was written, on the desktop host. */
  readonly savedPath?: string | null;
  /** The operator dismissed the save dialog of a `saveAs` request. */
  readonly cancelled?: boolean;
}

/**
 * A request whose successful body is written to a file the operator picks
 * rather than returned (desktop host only). Other transports ignore it.
 */
export interface SaveToFileInit extends RequestInit {
  readonly saveAs?: string;
}

/** What the desktop answers a `saveAs` request with when it cannot stream to disk (a paired till). */
export const SAVE_TO_FILE_UNSUPPORTED_STATUS = 501;

export type Transport = (path: string, init?: RequestInit) => Promise<TransportResponse>;

interface MezanIpcResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface MezanIpcFileResponse extends MezanIpcResponse {
  savedPath: string | null;
  cancelled: boolean;
}

interface MezanBridge {
  fetch(input: string, init?: RequestInit): Promise<MezanIpcResponse>;
  fetchToFile?(input: string, init: RequestInit | undefined, defaultFileName: string): Promise<MezanIpcFileResponse>;
}

/** Whether this renderer can stream a download straight to disk. */
export function canSaveToFile(): boolean {
  return typeof getBridge()?.fetchToFile === "function";
}

const RETRY_AFTER = "retry-after";
const SESSION_ENDED = "x-mezan-session-ended";

export enum SessionEndedReason {
  Displaced = "displaced",
}

export function retryAfterSecondsOf(header: string | null | undefined): number | null {
  if (header === null || header === undefined || !/^\s*\d+(\.\d+)?\s*$/.test(header)) return null;
  const seconds = Math.ceil(Number.parseFloat(header));
  return seconds > 0 ? seconds : null;
}

function headerOf(headers: Record<string, string> | undefined, name: string): string | null {
  for (const [key, value] of Object.entries(headers ?? {})) if (key.toLowerCase() === name) return value;
  return null;
}

function getBridge(): MezanBridge | undefined {
  return (globalThis as { mezan?: MezanBridge }).mezan;
}

/** HTTP transport for the web/dev build — talks to the `/api` middleware (or a proxied apps/server). */
export function createHttpTransport(baseUrl = "/api"): Transport {
  return async (path, init) => {
    const res = await fetch(`${baseUrl}${path}`, { ...init, credentials: "same-origin" });
    return {
      status: res.status,
      ok: res.ok,
      retryAfterSeconds: retryAfterSecondsOf(res.headers.get(RETRY_AFTER)),
      sessionEnded: res.headers.get(SESSION_ENDED),
      json: <T,>() => res.json() as Promise<T>,
      text: () => res.text(),
      blob: () => res.blob(),
      header: (name) => res.headers.get(name),
    };
  };
}

/**
 * Electron transport — marshals through the preload bridge into the in-process
 * app. A host is prepended because `new Request()` (which the IPC handler
 * builds) rejects a bare pathname; Hono matches on the pathname only.
 */
/**
 * HEADERS MUST CROSS THE BRIDGE AS A PLAIN OBJECT.
 *
 * `ApiContext.request` builds a real `Headers` instance — correct for `fetch`,
 * and silently fatal here. `contextBridge` structured-clones every argument
 * into the isolated world, and a `Headers` object has NO own enumerable
 * properties: it arrives in the preload as `{}`. So `Authorization` — and the
 * branch/warehouse scope headers with it — were dropped on every desktop
 * request, while the browser build, where `fetch` accepts a `Headers` natively,
 * worked perfectly.
 *
 * What that looked like: sign in, get a 200 and a valid token, and then watch
 * every single request come back 401 — which the renderer reads as an expired
 * session, so it clears it and bounces straight back to the login screen with
 * «انتهت الجلسة». The password was never the problem, and no amount of retyping it
 * could have been.
 */
function plainHeaders(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function createElectronTransport(bridge: MezanBridge): Transport {
  return async (path, init) => {
    const { saveAs, ...rest } = (init ?? {}) as SaveToFileInit;
    const plain = { ...rest, headers: plainHeaders(rest.headers) };
    const res = saveAs !== undefined && bridge.fetchToFile
      ? await bridge.fetchToFile(`http://mezan.local${path}`, plain, saveAs)
      : await bridge.fetch(`http://mezan.local${path}`, plain);
    return {
      savedPath: "savedPath" in res ? (res as MezanIpcFileResponse).savedPath : undefined,
      cancelled: "cancelled" in res ? (res as MezanIpcFileResponse).cancelled : undefined,
      status: res.status,
      ok: res.status >= 200 && res.status < 400,
      retryAfterSeconds: retryAfterSecondsOf(headerOf(res.headers, RETRY_AFTER)),
      sessionEnded: headerOf(res.headers, SESSION_ENDED),
      json: <T,>() => Promise.resolve(JSON.parse(res.body) as T),
      text: () => Promise.resolve(res.body),
      header: (name) => res.headers[name] ?? null,
    };
  };
}

/** Picks the Electron bridge when present, else the HTTP transport. */
export function resolveDefaultTransport(): Transport {
  const bridge = getBridge();
  return bridge ? createElectronTransport(bridge) : createHttpTransport();
}
