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
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
  header?(name: string): string | null;
}

export type Transport = (path: string, init?: RequestInit) => Promise<TransportResponse>;

interface MezanIpcResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface MezanBridge {
  fetch(input: string, init?: RequestInit): Promise<MezanIpcResponse>;
}

function getBridge(): MezanBridge | undefined {
  return (globalThis as { mezan?: MezanBridge }).mezan;
}

/** HTTP transport for the web/dev build — talks to the `/api` middleware (or a proxied apps/server). */
export function createHttpTransport(baseUrl = "/api"): Transport {
  return async (path, init) => {
    const res = await fetch(`${baseUrl}${path}`, init);
    return {
      status: res.status,
      ok: res.ok,
      json: <T,>() => res.json() as Promise<T>,
      text: () => res.text(),
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
 * «انتهت الجلسة». The PIN was never the problem, and no amount of retyping it
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
    const res = await bridge.fetch(`http://mezan.local${path}`, {
      ...init,
      headers: plainHeaders(init?.headers),
    });
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 400,
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
