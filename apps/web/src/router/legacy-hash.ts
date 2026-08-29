/**
 * Rewrites a pre-router `#/sales/quotes/QT-0004` address to `/sales/quotes/QT-0004`.
 *
 * The shell addressed every screen through the hash for its whole life, so the
 * addresses people saved, bookmarked, pasted into support tickets and wrote
 * into internal documents all carry one. Shipping path routing without this
 * turns every one of them into the dashboard — silently, because `#/…` is a
 * fragment the router never sees and so never reports as unmatched.
 *
 * Runs ONCE, before the router is created, and uses `replaceState` so the dead
 * address does not sit in the history stack waiting for the Back button.
 */
export function redirectLegacyHashRoute(): void {
  const { hash, pathname, search } = window.location;
  if (!hash.startsWith("#/")) return;
  // Only rewrite from the app root. A hash on a real path is someone's
  // in-page anchor, not an old route.
  if (pathname !== "/" && pathname !== "/index.html") return;

  const target = hash.slice(1);
  window.history.replaceState(null, "", `${target}${search}`);
}
