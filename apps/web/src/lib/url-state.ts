import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

/**
 * List state that lives in the URL instead of in `useState`.
 *
 * The migration to real paths gave every SCREEN an address. It did not give
 * the screen's own state one: a stock list searched for «أرز» and narrowed to
 * «نافد» was still `/items/items`, so it could not be linked to a colleague,
 * kept as a bookmark, or reloaded into — the filters reset and the operator
 * set them again. That is the same complaint the sub-page work fixed one level
 * up, and it is fixed the same way: put the state in the address.
 *
 * WHAT BELONGS HERE is the QUERY — what the user narrowed to, which page they
 * are on, how it is sorted. What does NOT belong here is transient UI: an open
 * side panel, a half-typed draft, an error banner. Those are not a place in
 * the app, and putting them in the URL invites someone to link to a
 * half-finished form.
 *
 * Every write REPLACES rather than pushes. A filter is not a destination — if
 * each chip click pushed a history entry, Back would walk the user through
 * twelve filter states before it left the screen, and typing six characters in
 * a search box would bury the previous screen six entries deep.
 *
 * A value equal to its default is REMOVED from the URL, so an untouched screen
 * is a clean `/items/items` rather than `?q=&status=all&page=1`.
 */

/**
 * Writes from one event handler, merged into a single URL update.
 *
 * Two `setSearchParams` calls in the same handler do NOT compose: each
 * functional updater is handed the params as they were before the handler ran,
 * so the second silently discards the first. Every filter here sets its own
 * value AND resets the page — two writes — so without this, ticking a chip
 * wrote `page` and dropped the chip. Verified by clicking it.
 *
 * The buffer is module-level because there is one URL: whichever hook instance
 * flushes it carries every pending change with it.
 */
let pendingPatch: Record<string, string | null> | null = null;

function useUrlPatch(): (patch: Record<string, string | null>) => void {
  const [, setParams] = useSearchParams();
  // INVARIANT: the returned function never changes identity. react-router
  // rebuilds `setSearchParams` on every address change; a setter rebuilt from
  // it re-fires any effect that lists it as a dependency each time the URL
  // moves, and an effect that resets the page then undoes every page click.
  const latestSetParams = useRef(setParams);
  useLayoutEffect(() => {
    latestSetParams.current = setParams;
  }, [setParams]);
  return useCallback(
    (patch) => {
      pendingPatch = { ...(pendingPatch ?? {}), ...patch };
      queueMicrotask(() => {
        const flush = pendingPatch;
        if (!flush) return;
        pendingPatch = null;
        latestSetParams.current(
          (prev) => {
            const copy = new URLSearchParams(prev);
            for (const [k, v] of Object.entries(flush)) {
              if (v === null) copy.delete(k);
              else copy.set(k, v);
            }
            return copy;
          },
          { replace: true },
        );
      });
    },
    [],
  );
}

/** Reads and writes one string parameter. Absent from the URL when it equals `fallback`. */
export function useUrlParam(key: string, fallback = ""): [string, (next: string) => void] {
  const [params] = useSearchParams();
  const patch = useUrlPatch();
  const value = params.get(key) ?? fallback;
  const set = useCallback(
    (next: string) => patch({ [key]: next === fallback || next === "" ? null : next }),
    [key, fallback, patch],
  );
  return [value, set];
}

/** The same, for a whole-number parameter — a page index, a page size. */
export function useUrlNumber(key: string, fallback: number): [number, (next: number) => void] {
  const [params] = useSearchParams();
  const patch = useUrlPatch();
  const raw = params.get(key);
  const parsed = raw === null ? Number.NaN : Number(raw);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  const set = useCallback(
    (next: number) => patch({ [key]: next === fallback ? null : String(next) }),
    [key, fallback, patch],
  );
  return [value, set];
}

/** A flag that is present in the URL only while it is on. */
export function useUrlFlag(key: string): [boolean, (next: boolean) => void] {
  const [params] = useSearchParams();
  const patch = useUrlPatch();
  const value = params.get(key) === "1";
  const set = useCallback((next: boolean) => patch({ [key]: next ? "1" : null }), [key, patch]);
  return [value, set];
}

/**
 * A search box whose text is in the URL, without a router update per keystroke.
 *
 * The typed value stays in local state so the input responds immediately, and
 * only the SETTLED value reaches the address. Writing straight through would
 * re-render the whole shell — the layout reads `useLocation` — on every
 * character, and would put six URL states in the history for one word.
 *
 * Returns the live text to bind to the input, its setter, and the settled text
 * to use as a query key.
 */
export function useUrlSearch(key = "q", delayMs = 300): [string, (next: string) => void, string] {
  const [params] = useSearchParams();
  const patch = useUrlPatch();
  const fromUrl = params.get(key) ?? "";
  const [text, setText] = useState(fromUrl);

  // An address arriving from outside — a pasted link, Back, a nav click that
  // clears the query — must win over what is in the box.
  useEffect(() => {
    setText((current) => (current === fromUrl ? current : fromUrl));
  }, [fromUrl]);

  useEffect(() => {
    if (text === fromUrl) return;
    const timer = window.setTimeout(() => {
      patch({ [key]: text.trim() === "" ? null : text });
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [text, fromUrl, key, delayMs, patch]);

  return [text, setText, fromUrl];
}

/**
 * A column sort in the URL as `sort=code:asc`.
 *
 * One parameter rather than two: a sort is one fact, and splitting it lets a
 * direction outlive the column it belonged to.
 */
export function useUrlSort<K extends string>(
  fallback: { key: K; direction: "asc" | "desc" },
  paramKey = "sort",
): [{ key: K; direction: "asc" | "desc" }, (next: { key: K; direction: "asc" | "desc" }) => void] {
  const [raw, setRaw] = useUrlParam(paramKey, `${fallback.key}:${fallback.direction}`);
  const value = useMemo(() => {
    const [k, d] = raw.split(":");
    if (!k) return fallback;
    return { key: k as K, direction: d === "desc" ? "desc" : "asc" } as const;
  }, [raw, fallback]);
  const set = useCallback(
    (next: { key: K; direction: "asc" | "desc" }) => setRaw(`${next.key}:${next.direction}`),
    [setRaw],
  );
  return [value, set];
}
