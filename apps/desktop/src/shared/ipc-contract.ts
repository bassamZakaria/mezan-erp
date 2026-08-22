/**
 * The wire shape carried over the `mezan:fetch` IPC channel, shared between
 * the preload bridge and the main-process handler. Both sides marshal a
 * `Request`/`Response` pair through structured-clone-safe plain objects,
 * mirroring the same Hono `app.fetch()` contract the HTTP mount uses
 * (docs/plan.md §2.2) so the renderer's data layer sees byte-identical
 * semantics regardless of which `fetch` implementation it is handed.
 */

export const MEZAN_FETCH_CHANNEL = "mezan:fetch";

export interface IpcFetchRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface IpcFetchResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * The shape exposed on `window.mezan` by the preload bridge. Kept minimal —
 * one `fetch`-shaped call — so the renderer's HTTP client abstraction only
 * has to swap the `fetch` implementation between editions (real `fetch`
 * online, `window.mezan.fetch` on desktop), never branch on platform.
 */
export interface MezanBridge {
  fetch(input: string, init?: RequestInit): Promise<IpcFetchResponse>;
}
