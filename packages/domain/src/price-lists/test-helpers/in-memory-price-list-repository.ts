import type { PriceList } from "../price-list.js";
import type { PriceListRepository } from "../ports.js";

/** A trivial in-memory {@link PriceListRepository} fake for domain-layer unit tests. */
export class InMemoryPriceListRepository implements PriceListRepository {
  private readonly rows = new Map<string, PriceList>();

  async save(priceList: PriceList): Promise<void> {
    this.rows.set(priceList.id, priceList);
  }

  async update(priceList: PriceList): Promise<void> {
    this.rows.set(priceList.id, priceList);
  }

  async findById(id: string): Promise<PriceList | null> {
    return this.rows.get(id) ?? null;
  }

  async list(filter?: { active?: boolean }): Promise<readonly PriceList[]> {
    const all = [...this.rows.values()];
    if (filter?.active === undefined) return all;
    return all.filter((pl) => pl.active === filter.active);
  }
}
