import type { CustomerDTO } from "@mezan/contracts";
import { ApiError, customerParams, type CustomerListFilter } from "./hooks";
import type { TransportResponse } from "./transport";

/**
 * The query a list screen asks for, described ONCE so the route loader and the
 * screen's own `useQuery` cannot disagree.
 *
 * They must produce the same query key. A loader that builds a subtly
 * different one warms a cache entry the screen never reads — it costs a
 * request, saves nothing, and does it silently. Sharing the descriptor is what
 * makes that impossible rather than merely unlikely.
 *
 * This module is imported by `router/routes.tsx`, so it must NOT import a
 * screen: that would pull the screen out of its lazy chunk and back into the
 * entry bundle. It only reaches into `data/`, which the shell already loads.
 */

type Request = (path: string, init?: RequestInit) => Promise<TransportResponse>;

export interface ListQuery<T> {
  readonly queryKey: readonly unknown[];
  readonly queryFn: (request: Request) => Promise<T>;
}

/**
 * The customer list's filter, read from the address.
 *
 * The SAME function feeds the screen and the loader, so the two cannot drift.
 * The parameter names are the ones `lib/url-state.ts` writes.
 */
export function customerFilterFromUrl(url: URL): CustomerListFilter {
  const p = url.searchParams;
  const q = p.get("q")?.trim();
  return {
    status: (p.get("status") ?? "all") as CustomerListFilter["status"],
    q: q ? q : undefined,
    priceListId: p.get("priceList") ?? undefined,
    overLimit: p.get("overLimit") === "1" ? true : undefined,
  };
}

export function customersQuery(filter: CustomerListFilter): ListQuery<CustomerDTO[]> {
  return {
    queryKey: ["customers", filter],
    queryFn: async (request) => {
      const qs = customerParams(filter).toString();
      const res = await request(`/customers${qs ? `?${qs}` : ""}`);
      // The loader swallows this; the screen's own useQuery reports it with a
      // translated message. Neither path shows this string to anyone.
      if (!res.ok) throw new ApiError(res.status, "customers");
      return res.json<CustomerDTO[]>();
    },
  };
}
