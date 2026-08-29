/**
 * The empty list a not-yet-loaded query falls back to.
 *
 * `query.data ?? []` allocates a NEW array on every render the data has not
 * arrived on. Feed that into a `useMemo`/`useCallback` dependency array — which
 * nearly every list screen does — and the memo can never hit: it sees a
 * different array identity each render and recomputes the filter, the sort and
 * the derived counts every keystroke in the search box. React Query already
 * returns a stable reference once the data is there, so this closes the only
 * gap.
 *
 * Typed `never[]` rather than `readonly never[]`: the union `T[] | never[]`
 * collapses to `T[]`, so it drops into every existing signature untouched,
 * whereas a readonly marker would have to be threaded through dozens of call
 * sites that legitimately take a mutable list.
 *
 * Sharing one mutable constant is safe HERE and only here, because the element
 * type is `never`: nothing can be pushed into it (there is no value of type
 * `never` to push), and reversing or sorting an empty array does nothing. Do
 * not widen the element type — that safety is what the type is buying.
 */
export const EMPTY: never[] = [];
