import type { TenantSettings } from "./settings.js";
import type { Branch } from "./branch.js";
import type { Warehouse } from "./warehouse.js";

/** Port for the single tenant-settings config bag (one row per tenant). */
export interface SettingsRepository {
  get(): Promise<TenantSettings | null>;
  save(settings: TenantSettings): Promise<void>;
}

/** Port for branch CRUD (docs/archive/catalog/09 §"إدارة الفروع"). */
export interface BranchRepository {
  findAll(): Promise<readonly Branch[]>;
  findById(id: string): Promise<Branch | null>;
  save(branch: Branch): Promise<void>;
}

/** Port for warehouse CRUD (docs/archive/catalog/09 §"إدارة المستودعات"). */
export interface WarehouseRepository {
  findAll(): Promise<readonly Warehouse[]>;
  findByBranch(branchId: string): Promise<readonly Warehouse[]>;
  findById(id: string): Promise<Warehouse | null>;
  save(warehouse: Warehouse): Promise<void>;
}
