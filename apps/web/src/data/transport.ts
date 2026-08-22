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
    };
  };
}

/**
 * Electron transport — marshals through the preload bridge into the in-process
 * app. A host is prepended because `new Request()` (which the IPC handler
 * builds) rejects a bare pathname; Hono matches on the pathname only.
 */
export function createElectronTransport(bridge: MezanBridge): Transport {
  return async (path, init) => {
    const res = await bridge.fetch(`http://mezan.local${path}`, init);
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 400,
      json: <T,>() => Promise.resolve(JSON.parse(res.body) as T),
      text: () => Promise.resolve(res.body),
    };
  };
}

/** Picks the Electron bridge when present, else the HTTP transport. */
export function resolveDefaultTransport(): Transport {
  const bridge = getBridge();
  return bridge ? createElectronTransport(bridge) : createHttpTransport();
}
