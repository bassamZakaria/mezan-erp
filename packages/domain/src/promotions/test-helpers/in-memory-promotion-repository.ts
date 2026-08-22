import type { Promotion } from "../promotion.js";
import type { PromotionListFilter, PromotionRepository } from "../ports.js";

/** A trivial in-memory {@link PromotionRepository} fake for domain-layer unit tests. */
export class InMemoryPromotionRepository implements PromotionRepository {
  private readonly rows = new Map<string, Promotion>();

  async save(promotion: Promotion): Promise<void> {
    this.rows.set(promotion.id, promotion);
  }

  async update(promotion: Promotion): Promise<void> {
    this.rows.set(promotion.id, promotion);
  }

  async findById(id: string): Promise<Promotion | null> {
    return this.rows.get(id) ?? null;
  }

  async list(filter: PromotionListFilter = {}): Promise<readonly Promotion[]> {
    const all = [...this.rows.values()];
    return filter.active === undefined ? all : all.filter((p) => p.active === filter.active);
  }
}
