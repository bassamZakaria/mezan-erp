export type {
  Item,
  ItemRepository,
  ItemType,
  CostingMethod,
  ItemStatus,
  EtaCodeType,
  AlternateUnit,
  ItemSpecificationValue,
} from "./item.js";
export { ItemStatusCode } from "./item.js";
export {
  DuplicateItemCodeError,
  ItemNotFoundError,
  InvalidItemError,
  ItemPriceRequiredError,
  ItemStatusNotSettableError,
  ItemPendingPricingError,
  DuplicateItemSpecificationCodeError,
  ItemSpecificationNotFoundError,
  InvalidItemSpecificationError,
  ItemSpecificationInUseError,
} from "./errors.js";
export {
  ITEM_TYPES,
  itemTypeCapabilities,
  itemTypeTracksStock,
  itemTypeIsSellable,
  itemTypeIsPurchasable,
  itemTypeIsBomComponent,
  itemTypeIsBomOutput,
  type ItemTypeCapabilities,
} from "./item-type.js";
export { validateAlternateUnits, validateGlAccountRefs, collectItemFieldErrors } from "./validation.js";
export { validateNewItem, createItem, type CreateItemCommand } from "./create-item.js";
export { updateItem, type UpdateItemCommand } from "./update-item.js";
export {
  createItemUnit,
  updateItemUnit,
  createItemCategory,
  updateItemCategory,
  DuplicateItemUnitCodeError,
  ItemUnitNotFoundError,
  ItemCategoryNotFoundError,
  InvalidItemCategoryError,
  type ItemCatalogStatus,
  type ItemUnit,
  type ItemUnitRepository,
  type CreateItemUnitCommand,
  type UpdateItemUnitCommand,
  type ItemCategory,
  type ItemCategoryRepository,
  type ItemBrand,
  type ItemBrandRepository,
  type ItemSeason,
  type ItemSeasonRepository,
  type CreateItemCategoryCommand,
  type UpdateItemCategoryCommand,
} from "./item-catalog.js";

export {
  ITEM_SPECIFICATION_TYPES,
  createItemSpecification,
  updateItemSpecification,
  deleteItemSpecification,
  type ItemSpecificationType,
  type ItemSpecification,
  type ItemSpecificationRepository,
  type ItemSpecificationUsageCounter,
  type CreateItemSpecificationCommand,
  type UpdateItemSpecificationCommand,
} from "./item-specification.js";
