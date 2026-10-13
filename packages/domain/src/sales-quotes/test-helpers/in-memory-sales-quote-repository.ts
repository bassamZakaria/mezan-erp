import { insertOnly } from "../../records/test-helpers/insert-only.js";
import type { SalesQuote } from "../sales-quote.js";
import type { SalesQuoteListFilter, SalesQuoteRepository } from "../ports.js";

/** Trivial in-memory {@link SalesQuoteRepository} for domain-layer + UI tests. */
export class InMemorySalesQuoteRepository implements SalesQuoteRepository {
  private readonly rows = new Map<string, SalesQuote>();

  async save(quote: SalesQuote): Promise<void> {
    insertOnly(this.rows, quote.id, quote);
  }

  async update(quote: SalesQuote): Promise<void> {
    this.rows.set(quote.id, quote);
  }

  async findById(id: string): Promise<SalesQuote | null> {
    return this.rows.get(id) ?? null;
  }

  async list(filter: SalesQuoteListFilter = {}): Promise<readonly SalesQuote[]> {
    return [...this.rows.values()]
      .filter((q) => (filter.status ? q.status === filter.status : true))
      .filter((q) => (filter.customerId ? q.customerId === filter.customerId : true))
      .filter((q) => (filter.fromDate ? q.date >= filter.fromDate : true))
      .filter((q) => (filter.toDate ? q.date <= filter.toDate : true))
      .sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
