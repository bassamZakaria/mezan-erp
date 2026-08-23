export type {
  Item,
  ItemRepository,
  ItemType,
  CostingMethod,
  ItemStatus,
  EtaCodeType,
  AlternateUnit,
} from "./item.js";
export { DuplicateItemCodeError, ItemNotFoundError, InvalidItemError } from "./errors.js";
export { validateAlternateUnits, validateGlAccountRefs, collectItemFieldErrors } from "./validation.js";
export { validateNewItem, createItem, type CreateItemCommand } from "./create-item.js";
export { updateItem, type UpdateItemCommand } from "./update-item.js";
export {
  DuplicateItemUnitCodeError,
  ItemUnitNotFoundError,
  InvalidItemUnitError,
  ItemUnitInUseError,
  DuplicateItemCategoryCodeError,
  ItemCategoryNotFoundError,
  InvalidItemCategoryError,
  ItemCategoryInUseError,
} from "./errors.js";
export {
  createItemUnit,
  updateItemUnit,
  deleteItemUnit,
  type ItemUnit,
  type ItemUnitRepository,
  type CreateItemUnitCommand,
  type UpdateItemUnitCommand,
} from "./item-unit.js";
export {
  createItemCategory,
  updateItemCategory,
  deleteItemCategory,
  type ItemCategory,
  type ItemCategoryRepository,
  type CreateItemCategoryCommand,
  type UpdateItemCategoryCommand,
} from "./item-category.js";
export {
  DuplicateItemSpecificationCodeError,
  ItemSpecificationNotFoundError,
  InvalidItemSpecificationError,
  ItemSpecificationInUseError,
  DuplicateProductTemplateCodeError,
  ProductTemplateNotFoundError,
  InvalidProductTemplateError,
  ProductTemplateAlreadyGeneratedError,
  ProductTemplateVariantNotFoundError,
} from "./product-catalog-errors.js";
export {
  createItemSpecification,
  updateItemSpecification,
  deleteItemSpecification,
  countItemSpecificationUsage,
  type ItemSpecification,
  type ItemSpecificationType,
  type ItemSpecificationRepository,
  type CreateItemSpecificationCommand,
  type UpdateItemSpecificationCommand,
} from "./item-specification.js";
export {
  createProductTemplate,
  updateProductTemplate,
  deleteProductTemplate,
  generateProductTemplateVariants,
  setProductTemplateVariantPrice,
  projectProductTemplateVariants,
  MAX_PRODUCT_TEMPLATE_VARIANTS,
  type ProductTemplate,
  type ProductTemplateStatus,
  type ProductTemplateOption,
  type ProductTemplateVariant,
  type ProductTemplateRepository,
  type ProductTemplateOptionInput,
  type ProductTemplateDeps,
  type CreateProductTemplateCommand,
  type UpdateProductTemplateCommand,
} from "./product-template.js";
