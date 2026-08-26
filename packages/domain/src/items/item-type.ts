/**
 * The six item types (docs/reference-parity/audit/REQUIREMENTS.md R5.1) and,
 * more importantly, what each one is ALLOWED to do.
 *
 * The rules used to be spelled out as `item.type === "stock"` in eight
 * unrelated places — four reports, the create defaults, the validator and two
 * screens. That is fine while there are two types and wrong the moment there
 * are six: every one of those checks silently excluded raw materials,
 * finished goods and consumables from stock valuation, because they are not
 * literally `"stock"`. Ask the capability, never the type.
 *
 * `"stock"` is the stored identifier for منتج (product); it keeps its old
 * value so existing rows need no migration.
 */
export type ItemType = "stock" | "service" | "raw_material" | "finished_good" | "consumable" | "recipe";

export interface ItemTypeCapabilities {
  /** Carries a quantity balance through warehouses, and is valued. */
  readonly tracksStock: boolean;
  /** May appear as a line on a sales document. */
  readonly sellable: boolean;
  /** May appear as a line on a purchase document. */
  readonly purchasable: boolean;
  /** May be a component line on a BOM or a recipe. */
  readonly bomComponent: boolean;
  /** May be the output of a BOM, a recipe or a work order. */
  readonly bomOutput: boolean;
}

const CAPABILITIES: Readonly<Record<ItemType, ItemTypeCapabilities>> = {
  stock: { tracksStock: true, sellable: true, purchasable: true, bomComponent: true, bomOutput: true },
  service: { tracksStock: false, sellable: true, purchasable: true, bomComponent: false, bomOutput: false },
  raw_material: { tracksStock: true, sellable: false, purchasable: true, bomComponent: true, bomOutput: false },
  finished_good: { tracksStock: true, sellable: true, purchasable: false, bomComponent: true, bomOutput: true },
  consumable: { tracksStock: true, sellable: false, purchasable: true, bomComponent: true, bomOutput: false },
  // A recipe is a definition, not a thing on a shelf: it is produced, never
  // stocked, bought or sold directly.
  recipe: { tracksStock: false, sellable: false, purchasable: false, bomComponent: false, bomOutput: true },
};

export const ITEM_TYPES: readonly ItemType[] = Object.keys(CAPABILITIES) as ItemType[];

export function itemTypeCapabilities(type: ItemType): ItemTypeCapabilities {
  return CAPABILITIES[type];
}

export function itemTypeTracksStock(type: ItemType): boolean {
  return CAPABILITIES[type].tracksStock;
}

export function itemTypeIsSellable(type: ItemType): boolean {
  return CAPABILITIES[type].sellable;
}

export function itemTypeIsPurchasable(type: ItemType): boolean {
  return CAPABILITIES[type].purchasable;
}

export function itemTypeIsBomComponent(type: ItemType): boolean {
  return CAPABILITIES[type].bomComponent;
}

export function itemTypeIsBomOutput(type: ItemType): boolean {
  return CAPABILITIES[type].bomOutput;
}
