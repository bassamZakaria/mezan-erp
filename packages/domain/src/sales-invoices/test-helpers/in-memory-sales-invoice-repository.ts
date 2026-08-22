import type { SalesInvoice } from "../sales-invoice.js";
import type { SalesInvoiceListFilter, SalesInvoiceRepository } from "../ports.js";

/** Trivial in-memory {@link SalesInvoiceRepository} for domain-layer + UI tests. */
export class InMemorySalesInvoiceRepository implements SalesInvoiceRepository {
  private readonly rows = new Map<string, SalesInvoice>();

  async save(invoice: SalesInvoice): Promise<void> {
    this.rows.set(invoice.id, invoice);
  }

  async update(invoice: SalesInvoice): Promise<void> {
    this.rows.set(invoice.id, invoice);
  }

  async findById(id: string): Promise<SalesInvoice | null> {
    return this.rows.get(id) ?? null;
  }

  async list(filter: SalesInvoiceListFilter = {}): Promise<readonly SalesInvoice[]> {
    return [...this.rows.values()]
      .filter((inv) => (filter.status ? inv.status === filter.status : true))
      .filter((inv) => (filter.customerId ? inv.customerId === filter.customerId : true))
      .filter((inv) => (filter.fromDate ? inv.date >= filter.fromDate : true))
      .filter((inv) => (filter.toDate ? inv.date <= filter.toDate : true))
      .sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
