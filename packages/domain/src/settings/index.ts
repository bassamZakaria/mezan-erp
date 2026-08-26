export {
  DEFAULT_SETTINGS,
  createDefaultSettings,
  updateSettings,
  InvalidSettingsError,
} from "./settings.js";
export type {
  TenantSettings,
  TaxCalculationMode,
  CreditControlMode,
  FxRateMissingPolicy,
  DepreciationProrateMode,
  NumeralSystem,
  UiDirection,
  SettingsLanguage,
  SmtpSecurity,
} from "./settings.js";

export { createBranch, updateBranch, InvalidBranchError } from "./branch.js";
export type { Branch, CreateBranchInput } from "./branch.js";

export {
  WAREHOUSE_TYPES,
  WAREHOUSE_TYPE_DEFINITIONS,
  getWarehouseTypeLabel,
  createWarehouse,
  updateWarehouse,
  InvalidWarehouseError,
} from "./warehouse.js";
export type { Warehouse, WarehouseType, WarehouseTypeDefinition, CreateWarehouseInput } from "./warehouse.js";

export type { SettingsRepository, BranchRepository, WarehouseRepository } from "./ports.js";
