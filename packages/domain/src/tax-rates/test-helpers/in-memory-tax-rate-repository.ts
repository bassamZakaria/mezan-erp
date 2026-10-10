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
    if (this.rows.has(taxRate.id)) throw new Error(`tax rate ${taxRate.id} already exists`);
    this.rows.set(taxRate.id, taxRate);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async update(taxRate: TaxRate): Promise<void> {
    this.rows.set(taxRate.id, taxRate);
  }
}
