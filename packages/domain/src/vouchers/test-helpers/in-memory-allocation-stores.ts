import type {
  AllocatableInvoice,
  AllocatableInvoiceRepository,
  AllocationRepository,
  VoucherAllocation,
} from "../allocation.js";
import type { AllocationInvoiceKind } from "../voucher-types.js";

/** In-memory {@link AllocationRepository} for domain-layer + UI tests. */
export class InMemoryAllocationRepository implements AllocationRepository {
  private readonly rows = new Map<string, VoucherAllocation>();

  async save(alloc: VoucherAllocation): Promise<void> {
    this.rows.set(alloc.id, alloc);
  }
  async update(alloc: VoucherAllocation): Promise<void> {
    this.rows.set(alloc.id, alloc);
  }
  async findById(id: string): Promise<VoucherAllocation | null> {
    return this.rows.get(id) ?? null;
  }
  async listByVoucher(voucherId: string): Promise<readonly VoucherAllocation[]> {
    return [...this.rows.values()].filter((a) => a.voucherId === voucherId);
  }
  async listByInvoice(invoiceId: string): Promise<readonly VoucherAllocation[]> {
    return [...this.rows.values()].filter((a) => a.invoiceId === invoiceId);
  }
}

/** In-memory {@link AllocatableInvoiceRepository} for domain-layer + UI tests. */
export class InMemoryInvoiceRepository implements AllocatableInvoiceRepository {
  private readonly rows = new Map<string, AllocatableInvoice>();

  constructor(seed: readonly AllocatableInvoice[] = []) {
    for (const invoice of seed) this.rows.set(invoice.id, invoice);
  }

  async findById(id: string): Promise<AllocatableInvoice | null> {
    return this.rows.get(id) ?? null;
  }
  async save(invoice: AllocatableInvoice): Promise<void> {
    this.rows.set(invoice.id, invoice);
  }
  async listAll(): Promise<readonly AllocatableInvoice[]> {
    return [...this.rows.values()];
  }
  async listOpen(filter: { kind?: AllocationInvoiceKind; partyId?: string }): Promise<readonly AllocatableInvoice[]> {
    return [...this.rows.values()].filter(
      (i) =>
        i.total.scaled - i.allocated.scaled > 0n &&
        (filter.kind ? i.kind === filter.kind : true) &&
        (filter.partyId ? i.partyId === filter.partyId : true),
    );
  }
}
