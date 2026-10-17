/**
 * Ports for the sales-quote module. The domain depends only on this
 * interface — never on SQL or HTTP (docs/archive/plan.md §3.2). Unlike sales
 * invoices, a quote has no GL/stock/workflow hook ports: it never posts and
 * never requires approval. It DOES reuse the document framework's
 * `DocumentNumberingHook` (documents/hooks.ts) for its number.
 */

import type { SalesQuote } from "./sales-quote.js";

/** Persistence port for sales quotes, keyed by id. */
export interface SalesQuoteRepository {
  save(quote: SalesQuote): Promise<void>;
  update(quote: SalesQuote): Promise<void>;
  findById(id: string): Promise<SalesQuote | null>;
  list(filter?: SalesQuoteListFilter): Promise<readonly SalesQuote[]>;
  /** Run `fn` in one atomic transaction. In-memory implementations may just call `fn`. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export interface SalesQuoteListFilter {
  readonly status?: SalesQuote["status"];
  readonly customerId?: string;
  readonly opportunityId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
}
