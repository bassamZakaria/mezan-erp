import { insertOnly } from "../records/test-helpers/insert-only.js";
/** In-memory fakes for the purchase-chain use-case tests. Test-only. */

import { NextNumberService, type SequenceStore } from "../numbering/index.js";
import { StockLedgerService } from "../inventory/index.js";
import {
  InMemoryStockLedger,
  InMemoryCostLayers,
  InMemorySnapshots,
} from "../inventory/test-helpers/in-memory-stores.js";
import type { PurchaseOrder, PurchaseOrderRepository } from "./purchase-order.js";
import type { GoodsReceipt, GoodsReceiptRepository } from "./goods-receipt.js";
import type { PurchaseInvoice, PurchaseInvoiceRepository } from "./purchase-invoice.js";
import type { PurchaseGlPosting, PurchaseGlPostingPort } from "./types.js";

/** Gap-free counter store; one row per (code, period). */
export class InMemorySequenceStore implements SequenceStore {
  private readonly counters = new Map<string, number>();
  async increment(code: string, period: number | null): Promise<number> {
    const key = `${code}|${period ?? "-"}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }
}

export function makeNumbering(): NextNumberService {
  return new NextNumberService(new InMemorySequenceStore());
}

export class InMemoryPurchaseOrders implements PurchaseOrderRepository {
  readonly rows = new Map<string, PurchaseOrder>();
  async findById(id: string): Promise<PurchaseOrder | null> {
    return this.rows.get(id) ?? null;
  }
  async list(): Promise<PurchaseOrder[]> {
    return [...this.rows.values()];
  }
  async create(order: PurchaseOrder): Promise<void> {
    insertOnly(this.rows, order.id, order);
  }
  async update(order: PurchaseOrder): Promise<void> {
    this.rows.set(order.id, order);
  }
}

export class InMemoryGoodsReceipts implements GoodsReceiptRepository {
  readonly rows = new Map<string, GoodsReceipt>();
  async findById(id: string): Promise<GoodsReceipt | null> {
    return this.rows.get(id) ?? null;
  }
  async list(): Promise<GoodsReceipt[]> {
    return [...this.rows.values()];
  }
  async listByOrder(purchaseOrderId: string): Promise<GoodsReceipt[]> {
    return [...this.rows.values()].filter((r) => r.purchaseOrderId === purchaseOrderId);
  }
  async create(receipt: GoodsReceipt): Promise<void> {
    insertOnly(this.rows, receipt.id, receipt);
  }
  async update(receipt: GoodsReceipt): Promise<void> {
    this.rows.set(receipt.id, receipt);
  }
}

export class InMemoryPurchaseInvoices implements PurchaseInvoiceRepository {
  readonly rows = new Map<string, PurchaseInvoice>();
  async findById(id: string): Promise<PurchaseInvoice | null> {
    return this.rows.get(id) ?? null;
  }
  async list(): Promise<PurchaseInvoice[]> {
    return [...this.rows.values()];
  }
  async create(invoice: PurchaseInvoice): Promise<void> {
    insertOnly(this.rows, invoice.id, invoice);
  }
  async update(invoice: PurchaseInvoice): Promise<void> {
    this.rows.set(invoice.id, invoice);
  }
}

/** Records every GL posting the purchase invoice hands off (for golden fixtures). */
export class RecordingGlPort implements PurchaseGlPostingPort {
  readonly postings: PurchaseGlPosting[] = [];
  async post(posting: PurchaseGlPosting): Promise<void> {
    this.postings.push(posting);
  }
}

/** A real StockLedgerService over in-memory stores, negative stock blocked. */
export function makeStockService(): StockLedgerService {
  return new StockLedgerService({
    ledger: new InMemoryStockLedger(),
    layers: new InMemoryCostLayers(),
    snapshots: new InMemorySnapshots(),
    policy: { allowNegativeStock: false },
    clock: () => "2026-08-21T00:00:00.000Z",
  });
}
