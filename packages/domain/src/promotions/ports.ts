import type { Promotion } from "./promotion.js";

export interface PromotionListFilter {
  readonly active?: boolean;
}

/** Persistence port for promotions. The domain depends on this interface only — no SQL, no driver. */
export interface PromotionRepository {
  save(promotion: Promotion): Promise<void>;
  update(promotion: Promotion): Promise<void>;
  findById(id: string): Promise<Promotion | null>;
  list(filter?: PromotionListFilter): Promise<readonly Promotion[]>;
}
