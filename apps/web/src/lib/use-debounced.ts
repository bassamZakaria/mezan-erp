import { useEffect, useState } from "react";

/**
 * Holds a value still for a moment before letting it through. The list filters
 * are query keys now that rows, chip counts and KPIs are all fetched (R1.1),
 * so an undebounced search box would fire three requests per keystroke.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

export interface SearchTerm {
  readonly term: string;
  readonly pending: boolean;
}

export function useSearchTerm(query: string): SearchTerm {
  const typed = query.trim();
  const term = useDebounced(typed);
  return { term, pending: term !== typed };
}
