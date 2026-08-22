import { Qty } from "../../money/index.js";
import type { CostLayer } from "../cost-layer.js";
import type { StockMovement } from "../movement.js";
import type {
  CostLayerRepository,
  StockLedgerRepository,
  WacSnapshot,
  WacSnapshotRepository,
} from "../ports.js";

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
