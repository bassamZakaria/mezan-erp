import type { PriceList } from "./price-list.js";

/** Persistence port for price lists. The domain depends on this interface only — no SQL, no driver. */
export interface PriceListRepository {
  save(priceList: PriceList): Promise<void>;
  update(priceList: PriceList): Promise<void>;
  findById(id: string): Promise<PriceList | null>;
  list(filter?: { active?: boolean }): Promise<readonly PriceList[]>;
}
