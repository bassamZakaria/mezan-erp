import type { LoaderFunctionArgs } from "react-router";
import { isSignedIn, loaderApi } from "../data/api-bridge";
import type { ListQuery } from "../data/list-queries";

/**
 * Builds a route loader that warms the cache before the screen renders.
 *
 * Declared STATICALLY on the route, never inside the route's `lazy` module.
 * That placement is the whole point: React Router runs a static loader
 * CONCURRENTLY with the lazy chunk's download. Put it inside the module and it
 * cannot start until the module has arrived, which is the serial waterfall this
 * exists to remove — download the chunk, parse it, render, run an effect, and
 * only then ask for the data.
 *
 * The queries come from `data/list-queries.ts`, which the screen's own hooks
 * read too. Building a key here instead would warm an entry nobody reads.
 *
 * A failed prefetch is deliberately NOT re-thrown. The route's error boundary
 * would replace the whole screen with a failure panel when the screen's own
 * `useQuery` is about to retry and can report the problem in place, beside the
 * table that is missing. A loader is an optimisation; it must never become a
 * new way for a screen to fail to open.
 */
export function listLoader(build: (url: URL) => readonly ListQuery<unknown>[]) {
  return async ({ request }: LoaderFunctionArgs): Promise<null> => {
    // Signed out, every query on the screen is disabled and the layout renders
    // the login gate. Prefetching here would fire unauthenticated calls that
    // come back 401 — which ApiContext treats as "session ended" and uses to
    // clear the cache out from under the login screen.
    if (!isSignedIn()) return null;
    const { queryClient, request: apiRequest } = loaderApi();
    const queries = build(new URL(request.url));
    await Promise.all(
      queries.map((q) =>
        queryClient
          .ensureQueryData({ queryKey: [...q.queryKey], queryFn: () => q.queryFn(apiRequest) })
          .catch(() => null),
      ),
    );
    return null;
  };
}
