import { SALES_INVOICE_ACTIVE_STATUSES, type SalesInvoice } from "../sales-invoice.js";
import type { SalesInvoiceField, SalesInvoiceListFilter, SalesInvoiceRepository, SalesInvoiceWritePrecondition } from "../ports.js";

const UNPOSTED_STATUSES: readonly SalesInvoice["status"][] = ["draft", "pending"];

/** Trivial in-memory {@link SalesInvoiceRepository} for domain-layer + UI tests. */
export class InMemorySalesInvoiceRepository implements SalesInvoiceRepository {
  private readonly rows = new Map<string, SalesInvoice>();

  async save(invoice: SalesInvoice): Promise<void> {
    this.rows.set(invoice.id, invoice);
  }

  async update(invoice: SalesInvoice): Promise<void> {
    this.rows.set(invoice.id, invoice);
  }

  async writeFields(next: SalesInvoice, fields: readonly SalesInvoiceField[], expected: SalesInvoiceWritePrecondition): Promise<boolean> {
    const stored = this.rows.get(next.id);
    if (!stored || !expected.status.includes(stored.status)) return false;
    this.rows.set(next.id, { ...stored, ...Object.fromEntries(fields.map((field) => [field, next[field]])) });
    return true;
  }

  async replaceUnposted(next: SalesInvoice, expected: SalesInvoiceWritePrecondition): Promise<boolean> {
    const stored = this.rows.get(next.id);
    if (!stored || !expected.status.includes(stored.status) || !UNPOSTED_STATUSES.includes(stored.status)) return false;
    this.rows.set(next.id, next);
    return true;
  }

  async nameLineTaxRate(invoiceId: string, lineIds: readonly string[], taxRatePercent: number, taxRateId: string): Promise<number> {
    const invoice = this.rows.get(invoiceId);
    if (!invoice || !SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) return 0;
    let named = 0;
    const lines = invoice.lines.map((line) => {
      if (!lineIds.includes(line.lineId) || (line.taxRateId ?? null) !== null || line.taxRatePercent !== taxRatePercent) return line;
      named += 1;
      return { ...line, taxRateId };
    });
    this.rows.set(invoiceId, { ...invoice, lines });
    return named;
  }

  async findById(id: string): Promise<SalesInvoice | null> {
    return this.rows.get(id) ?? null;
  }

  async findByDocNo(docNo: string): Promise<SalesInvoice | null> {
    return [...this.rows.values()].find((inv) => inv.docNo === docNo) ?? null;
  }

  private matching(filter: SalesInvoiceListFilter): SalesInvoice[] {
    const term = filter.search?.trim().toLowerCase();
    return [...this.rows.values()]
      .filter((inv) => (filter.status ? inv.status === filter.status : true))
      .filter((inv) => (filter.statusIn ? filter.statusIn.includes(inv.status) : true))
      .filter((inv) => (filter.customerId ? inv.customerId === filter.customerId : true))
      .filter((inv) => (filter.sourceQuoteId ? inv.sourceQuoteId === filter.sourceQuoteId : true))
      .filter((inv) => (filter.fromDate ? inv.date >= filter.fromDate : true))
      .filter((inv) => (filter.toDate ? inv.date <= filter.toDate : true))
      .filter((inv) => (filter.branchScope ? inv.branchId == null || filter.branchScope.includes(inv.branchId) : true))
      .filter((inv) =>
        filter.warehouseScope ? inv.warehouseId == null || filter.warehouseScope.includes(inv.warehouseId) : true,
      )
      .filter((inv) => (filter.branchId ? inv.branchId === filter.branchId : true))
      .filter((inv) => (filter.warehouseId ? inv.warehouseId === filter.warehouseId : true))
      .filter((inv) => (filter.salespersonId ? inv.salespersonId === filter.salespersonId : true))
      .filter((inv) =>
        term
          ? (inv.docNo ?? "").toLowerCase().includes(term) || (inv.customerNameAr ?? "").toLowerCase().includes(term)
          : true,
      )
      .sort((a, b) => {
        if (filter.sort?.key === "docNo") {
          if (a.docNo === null || b.docNo === null) {
            return a.docNo === b.docNo ? a.createdAt.localeCompare(b.createdAt) : a.docNo === null ? 1 : -1;
          }
          const byNo = a.docNo.localeCompare(b.docNo);
          return filter.sort.direction === "desc" ? -byNo : byNo;
        }
        return a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date);
      });
  }

  async list(filter: SalesInvoiceListFilter = {}): Promise<readonly SalesInvoice[]> {
    const rows = this.matching(filter);
    const offset = filter.offset ?? 0;
    return filter.limit === undefined ? rows : rows.slice(offset, offset + filter.limit);
  }

  async count(filter: SalesInvoiceListFilter = {}): Promise<number> {
    return this.matching(filter).length;
  }

  async countByStatus(filter: SalesInvoiceListFilter = {}): Promise<ReadonlyMap<SalesInvoice["status"], number>> {
    const { status: _status, statusIn: _statusIn, limit: _limit, offset: _offset, ...rest } = filter;
    const out = new Map<SalesInvoice["status"], number>();
    for (const inv of this.matching(rest)) out.set(inv.status, (out.get(inv.status) ?? 0) + 1);
    return out;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
