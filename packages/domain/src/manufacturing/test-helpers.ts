import { insertOnly } from "../records/test-helpers/insert-only.js";
/** In-memory fakes for the manufacturing use-case tests. Test-only. */

import { NextNumberService, type SequenceStore } from "../numbering/index.js";
import { StockLedgerService } from "../inventory/index.js";
import {
  InMemoryStockLedger,
  InMemoryCostLayers,
  InMemorySnapshots,
} from "../inventory/test-helpers/in-memory-stores.js";
import type { Bom, BomRepository } from "./bom.js";
import type { WorkOrder, WorkOrderRepository } from "./work-order.js";
import type { ConfigurableProduct, ConfigurableProductRepository } from "./configurable-product.js";
import type { ConfigInstance, ConfigInstanceRepository } from "./config-instance.js";
import type { ManufacturingGlPosting, ManufacturingGlPostingPort } from "./types.js";

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

export class InMemoryBoms implements BomRepository {
  readonly rows = new Map<string, Bom>();
  async findById(id: string): Promise<Bom | null> {
    return this.rows.get(id) ?? null;
  }
  async list(): Promise<Bom[]> {
    return [...this.rows.values()];
  }
  async listByProduct(productItemId: string): Promise<Bom[]> {
    return [...this.rows.values()].filter((b) => b.productItemId === productItemId);
  }
  async create(bom: Bom): Promise<void> {
    insertOnly(this.rows, bom.id, bom);
  }
  async update(bom: Bom): Promise<void> {
    this.rows.set(bom.id, bom);
  }
}

export class InMemoryWorkOrders implements WorkOrderRepository {
  readonly rows = new Map<string, WorkOrder>();
  async findById(id: string): Promise<WorkOrder | null> {
    return this.rows.get(id) ?? null;
  }
  async list(): Promise<WorkOrder[]> {
    return [...this.rows.values()];
  }
  async create(order: WorkOrder): Promise<void> {
    insertOnly(this.rows, order.id, order);
  }
  async update(order: WorkOrder): Promise<void> {
    this.rows.set(order.id, order);
  }
}

export class InMemoryConfigurableProducts implements ConfigurableProductRepository {
  readonly rows = new Map<string, ConfigurableProduct>();
  async findById(id: string): Promise<ConfigurableProduct | null> {
    return this.rows.get(id) ?? null;
  }
  async findByCode(code: string): Promise<ConfigurableProduct | null> {
    return [...this.rows.values()].find((p) => p.code === code) ?? null;
  }
  async list(): Promise<ConfigurableProduct[]> {
    return [...this.rows.values()];
  }
  async create(product: ConfigurableProduct): Promise<void> {
    insertOnly(this.rows, product.id, product);
  }
  async update(product: ConfigurableProduct): Promise<void> {
    this.rows.set(product.id, product);
  }
}

export class InMemoryConfigInstances implements ConfigInstanceRepository {
  readonly rows = new Map<string, ConfigInstance>();
  async findById(id: string): Promise<ConfigInstance | null> {
    return this.rows.get(id) ?? null;
  }
  async list(): Promise<ConfigInstance[]> {
    return [...this.rows.values()];
  }
  async create(instance: ConfigInstance): Promise<void> {
    insertOnly(this.rows, instance.id, instance);
  }
  async update(instance: ConfigInstance): Promise<void> {
    this.rows.set(instance.id, instance);
  }
}

/** Records every posting handed to it (the API turns these into journal entries). */
export class RecordingGlPort implements ManufacturingGlPostingPort {
  readonly postings: ManufacturingGlPosting[] = [];
  async post(posting: ManufacturingGlPosting): Promise<void> {
    this.postings.push(posting);
  }
}

/** A fresh StockLedgerService over in-memory stores, negative stock disallowed. */
export function makeStock(clock = () => "2026-08-22T00:00:00.000Z"): StockLedgerService {
  return new StockLedgerService({
    ledger: new InMemoryStockLedger(),
    layers: new InMemoryCostLayers(),
    snapshots: new InMemorySnapshots(),
    policy: { allowNegativeStock: false },
    clock,
  });
}
