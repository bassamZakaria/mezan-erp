import { insertOnly } from "../../records/test-helpers/insert-only.js";
import type { CostCenter, CostCenterRepository } from "../cost-center.js";

/** A trivial in-memory {@link CostCenterRepository} fake for domain-layer unit tests. */
export class InMemoryCostCenterRepository implements CostCenterRepository {
  private readonly rows = new Map<string, CostCenter>();

  async findById(id: string): Promise<CostCenter | null> {
    return this.rows.get(id) ?? null;
  }

  async findByCode(code: string): Promise<CostCenter | null> {
    for (const costCenter of this.rows.values()) {
      if (costCenter.code === code) return costCenter;
    }
    return null;
  }

  async list(): Promise<CostCenter[]> {
    return [...this.rows.values()];
  }

  async create(costCenter: CostCenter): Promise<void> {
    insertOnly(this.rows, costCenter.id, costCenter);
  }

  async update(costCenter: CostCenter): Promise<void> {
    this.rows.set(costCenter.id, costCenter);
  }
}
