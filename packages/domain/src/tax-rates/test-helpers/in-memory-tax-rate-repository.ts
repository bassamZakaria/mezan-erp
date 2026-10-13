import { insertOnly } from "../../records/test-helpers/insert-only.js";
import type { TaxRate, TaxRateRepository } from "../tax-rate.js";

/** A trivial in-memory {@link TaxRateRepository} fake for domain-layer unit tests. */
export class InMemoryTaxRateRepository implements TaxRateRepository {
  private readonly rows = new Map<string, TaxRate>();

  async findById(id: string): Promise<TaxRate | null> {
    return this.rows.get(id) ?? null;
  }

  async findByCode(code: string): Promise<TaxRate | null> {
    for (const taxRate of this.rows.values()) {
      if (taxRate.code === code) return taxRate;
    }
    return null;
  }

  async list(): Promise<TaxRate[]> {
    return [...this.rows.values()];
  }

  async create(taxRate: TaxRate): Promise<void> {
    insertOnly(this.rows, taxRate.id, taxRate);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async update(taxRate: TaxRate): Promise<void> {
    this.rows.set(taxRate.id, taxRate);
  }
}
