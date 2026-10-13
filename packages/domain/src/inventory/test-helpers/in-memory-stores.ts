import { insertOnly } from "../../records/test-helpers/insert-only.js";
import { Qty } from "../../money/index.js";
import type { CostLayer } from "../cost-layer.js";
import type { StockMovement } from "../movement.js";
import type {
  CostLayerRepository,
  StockLedgerRepository,
  WacSnapshot,
  WacSnapshotRepository,
} from "../ports.js";
import type { WritedownRun, WritedownRunRepository } from "../writedown-run.js";
import type {
  ProductTemplate,
  ProductTemplateRepository,
  ProductTemplateVariant,
  ProductTemplateVariantRepository,
} from "../product-template.js";

/** In-memory StockLedgerRepository preserving append order (ledger order). */
export class InMemoryStockLedger implements StockLedgerRepository {
  readonly movements: StockMovement[] = [];

  async append(movement: StockMovement): Promise<void> {
    if (this.movements.some((m) => m.id === movement.id)) {
      throw new Error(`duplicate movement id ${movement.id}`);
    }
    this.movements.push(movement);
  }
  async listByPosition(itemId: string, warehouseId: string): Promise<readonly StockMovement[]> {
    return this.movements.filter((m) => m.itemId === itemId && m.warehouseId === warehouseId);
  }
  async listByItem(itemId: string): Promise<readonly StockMovement[]> {
    return this.movements.filter((m) => m.itemId === itemId);
  }
  async listByWarehouse(warehouseId: string): Promise<readonly StockMovement[]> {
    return this.movements.filter((m) => m.warehouseId === warehouseId);
  }
  async listPositions(): Promise<readonly { itemId: string; warehouseId: string }[]> {
    const seen = new Map<string, { itemId: string; warehouseId: string }>();
    for (const m of this.movements) {
      seen.set(`${m.itemId}|${m.warehouseId}`, { itemId: m.itemId, warehouseId: m.warehouseId });
    }
    return [...seen.values()];
  }
}

/** In-memory CostLayerRepository preserving FIFO insertion order. */
export class InMemoryCostLayers implements CostLayerRepository {
  readonly layers: CostLayer[] = [];

  async add(layer: CostLayer): Promise<void> {
    this.layers.push(layer);
  }
  async listByPosition(itemId: string, warehouseId: string): Promise<readonly CostLayer[]> {
    return this.layers.filter((l) => l.itemId === itemId && l.warehouseId === warehouseId);
  }
  async updateRemaining(layerId: string, remainingQty: Qty): Promise<void> {
    const idx = this.layers.findIndex((l) => l.id === layerId);
    if (idx >= 0) this.layers[idx] = { ...(this.layers[idx] as CostLayer), remainingQty };
  }
  async remove(layerId: string): Promise<void> {
    const idx = this.layers.findIndex((l) => l.id === layerId);
    if (idx >= 0) this.layers.splice(idx, 1);
  }
}

/** In-memory WacSnapshotRepository. */
export class InMemorySnapshots implements WacSnapshotRepository {
  private readonly byKey = new Map<string, WacSnapshot>();
  private key(itemId: string, warehouseId: string): string {
    return `${itemId}|${warehouseId}`;
  }
  async get(itemId: string, warehouseId: string): Promise<WacSnapshot | null> {
    return this.byKey.get(this.key(itemId, warehouseId)) ?? null;
  }
  async save(snapshot: WacSnapshot): Promise<void> {
    this.byKey.set(this.key(snapshot.itemId, snapshot.warehouseId), snapshot);
  }
  async list(): Promise<readonly WacSnapshot[]> {
    return [...this.byKey.values()];
  }
}

/** In-memory WritedownRunRepository (inv/labels-templates-writedown). */
export class InMemoryWritedownRuns implements WritedownRunRepository {
  private readonly rows = new Map<string, WritedownRun>();

  async findById(id: string): Promise<WritedownRun | null> {
    return this.rows.get(id) ?? null;
  }
  async findByPeriod(period: string, warehouseId: string | null): Promise<WritedownRun | null> {
    for (const row of this.rows.values()) {
      if (row.period === period && row.warehouseId === warehouseId) return row;
    }
    return null;
  }
  async list(): Promise<WritedownRun[]> {
    return [...this.rows.values()];
  }
  async create(run: WritedownRun): Promise<void> {
    insertOnly(this.rows, run.id, run);
  }
  async update(run: WritedownRun): Promise<void> {
    this.rows.set(run.id, run);
  }
}

/** In-memory ProductTemplateRepository (inv/labels-templates-writedown). */
export class InMemoryProductTemplates implements ProductTemplateRepository {
  private readonly rows = new Map<string, ProductTemplate>();

  async findById(id: string): Promise<ProductTemplate | null> {
    return this.rows.get(id) ?? null;
  }
  async findByCode(code: string): Promise<ProductTemplate | null> {
    for (const row of this.rows.values()) {
      if (row.code === code) return row;
    }
    return null;
  }
  async list(): Promise<ProductTemplate[]> {
    return [...this.rows.values()];
  }
  async create(template: ProductTemplate): Promise<void> {
    insertOnly(this.rows, template.id, template);
  }
  async update(template: ProductTemplate): Promise<void> {
    this.rows.set(template.id, template);
  }
}

/** In-memory ProductTemplateVariantRepository (inv/labels-templates-writedown). */
export class InMemoryProductTemplateVariants implements ProductTemplateVariantRepository {
  private readonly rows: ProductTemplateVariant[] = [];

  async listByTemplate(templateId: string): Promise<readonly ProductTemplateVariant[]> {
    return this.rows.filter((v) => v.templateId === templateId);
  }
  async create(variant: ProductTemplateVariant): Promise<void> {
    this.rows.push(variant);
  }
}
