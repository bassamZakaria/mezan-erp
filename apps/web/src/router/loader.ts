import type { LoaderFunctionArgs } from "react-router";
import { isSignedIn, loaderApi } from "../data/api-bridge";
import { ApiError } from "../data/hooks";

/**
 * A query a screen needs, described once so both the route loader and the
 * screen's own `useQuery` can ask for it.
 *
 * The loader prefetches it into the cache; the component reads it back through
 * React Query as it always did. The alternative — `useLoaderData` in place of
 * `useQuery` — would take the data out of the cache, and with it every
 * `invalidateQueries` this app's mutations depend on to refresh a list after a
 * confirm, a return or a voucher.
 */
export interface ScreenQuery<T> {
  readonly queryKey: readonly unknown[];
  readonly queryFn: (request: (path: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json<J>(): Promise<J> }>) => Promise<T>;
}

/**
 * Builds a route loader that warms the cache before the screen renders.
 *
 * Without this a screen mounts, THEN asks for its data — the request cannot
 * start until the route chunk has downloaded, parsed and rendered once. The
 * loader runs as soon as the match is known, so the fetch overlaps the render
 * instead of following it.
 *
 * A failed prefetch is deliberately NOT re-thrown. The route's error boundary
 * would replace the whole screen with a failure panel, when the screen's own
 * `useQuery` is about to retry and can report the problem in place, next to
 * the table that is missing. A loader is an optimisation; it must not become a
 * new way for a screen to fail to open.
 */
export function screenLoader(...queries: readonly ScreenQuery<unknown>[]) {
  return async (_args: LoaderFunctionArgs): Promise<null> => {
    // Signed out, the screen renders the login gate and every query is
    // disabled. Prefetching here would fire unauthenticated calls that come
    // back 401 and sign the session out from under the login screen.
    if (!isSignedIn()) return null;
    const { queryClient, request } = loaderApi();
    await Promise.all(
      queries.map((q) =>
        queryClient
          .ensureQueryData({ queryKey: [...q.queryKey], queryFn: () => q.queryFn(request) })
          .catch((err: unknown) => {
            if (err instanceof ApiError) return null;
            return null;
          }),
      ),
    );
    return null;
  };
}
