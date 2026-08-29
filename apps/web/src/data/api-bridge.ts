import type { QueryClient } from "@tanstack/react-query";
import type { TransportResponse } from "./transport";

/**
 * The door route loaders use to reach the API and the query cache.
 *
 * A React Router loader runs OUTSIDE React — the router calls it before it
 * renders the match, so there is no component, no hook, and no context. But
 * `request` deliberately lives in ApiContext, because it closes over the
 * session and the working-branch scope and owns the 401-means-signed-out
 * handling that every call depends on. Reimplementing it here would fork that
 * logic, and the fork would drift.
 *
 * So the provider PUBLISHES its live value here instead, and loaders read it.
 * One implementation, two callers.
 *
 * Published during ApiProvider's render rather than in an effect: the router
 * can call a loader before effects for that commit have run, and a loader that
 * reads `null` would sign the user out on a spurious 401. Assignment is
 * idempotent, so StrictMode's double render is harmless.
 */
export interface LoaderApi {
  readonly request: (path: string, init?: RequestInit) => Promise<TransportResponse>;
  readonly queryClient: QueryClient;
  /** Null when signed out — loaders must not fetch, and the route redirects to login. */
  readonly isAuthenticated: boolean;
}

let current: LoaderApi | null = null;

export function publishLoaderApi(api: LoaderApi): void {
  current = api;
}

/*
 * There is deliberately NO clear-on-unmount.
 *
 * It used to be `useEffect(() => clearLoaderApi, [])` in the provider, which
 * looks like tidy cleanup and silently disabled every loader. StrictMode
 * mounts effects, unmounts them and remounts them, so the order was: render
 * (publish) → mount → CLEANUP (clear) → remount. The remount only returns the
 * cleanup again and no re-render follows, so this stayed null for the rest of
 * the session and every loader correctly declined to fetch without a session.
 *
 * Nothing needs the clear: the app has one provider for its lifetime, the next
 * provider's first render overwrites this, and a loader cannot run once the
 * router that owns it is gone.
 */

/**
 * Throws rather than returning null: a loader that silently skipped its fetch
 * would render the screen with an empty cache, and an empty list is
 * indistinguishable from a tenant that genuinely has no rows.
 */
export function loaderApi(): LoaderApi {
  if (!current) {
    throw new Error("Route loader ran before <ApiProvider> published its API. Is the router mounted inside AppProviders?");
  }
  return current;
}

/** True once a session exists, so a loader can decline to fetch while signed out. */
export function isSignedIn(): boolean {
  return current?.isAuthenticated ?? false;
}
