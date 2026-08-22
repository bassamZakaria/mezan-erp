/**
 * @mezan/contracts — Zod schemas + inferred types shared by api, domain and web.
 *
 * This package is the single source of truth for over-the-wire shapes. It has
 * no dependency on domain, persistence, api or any driver, so every layer can
 * import it without pulling in a runtime.
 */
export {
  journalLineSchema,
  createJournalEntrySchema,
  type JournalLineDTO,
  type CreateJournalEntryDTO,
} from "./journal.js";

export {
  sequenceDefinitionSchema,
  nextNumberRequestSchema,
  nextNumberResponseSchema,
  type SequenceDefinitionDTO,
  type NextNumberRequestDTO,
  type NextNumberResponseDTO,
} from "./numbering.js";

export {
  auditSeveritySchema,
  auditStreamSchema,
  auditEventSchema,
  type AuditSeverityDTO,
  type AuditStreamDTO,
  type AuditEventDTO,
} from "./audit.js";

export { domainEventSchema, type DomainEventDTO } from "./events.js";

export {
  featureFlagsSchema,
  entitlementsSchema,
  licensePayloadSchema,
  type EntitlementsDTO,
  type LicensePayloadDTO,
} from "./entitlements.js";

export {
  deviceSessionSchema,
  connectDeviceRequestSchema,
  lanStatusSchema,
  lanSessionsListSchema,
  type DeviceSessionDTO,
  type ConnectDeviceRequestDTO,
  type LanStatusDTO,
  type LanSessionsListDTO,
} from "./lan.js";

export {
  accountTypeSchema,
  naturalBalanceSchema,
  accountStatusSchema,
  accountSchema,
  createAccountSchema,
  updateAccountSchema,
  type AccountTypeDTO,
  type NaturalBalanceDTO,
  type AccountStatusDTO,
  type AccountDTO,
  type CreateAccountDTO,
  type UpdateAccountDTO,
} from "./accounts.js";

export {
  tenantSettingsSchema,
  updateTenantSettingsSchema,
  type TenantSettingsDTO,
  type UpdateTenantSettingsDTO,
} from "./settings.js";

export {
  branchSchema,
  createBranchSchema,
  updateBranchSchema,
  type BranchDTO,
  type CreateBranchDTO,
  type UpdateBranchDTO,
} from "./branch.js";

export {
  warehouseTypeSchema,
  warehouseSchema,
  createWarehouseSchema,
  updateWarehouseSchema,
  type WarehouseTypeDTO,
  type WarehouseDTO,
  type CreateWarehouseDTO,
  type UpdateWarehouseDTO,
} from "./warehouse.js";

export {
  etaBuyerTypeSchema,
  customerSchema,
  createCustomerSchema,
  updateCustomerSchema,
  type EtaBuyerTypeDTO,
  type CustomerDTO,
  type CreateCustomerDTO,
  type UpdateCustomerDTO,
} from "./customers.js";

export {
  supplierSchema,
  createSupplierSchema,
  updateSupplierSchema,
  type SupplierDTO,
  type CreateSupplierDTO,
  type UpdateSupplierDTO,
} from "./suppliers.js";

export {
  itemTypeSchema,
  costingMethodSchema,
  itemStatusSchema,
  etaCodeTypeSchema,
  alternateUnitSchema,
  itemSchema,
  createItemSchema,
  updateItemSchema,
  type ItemTypeDTO,
  type CostingMethodDTO,
  type ItemStatusDTO,
  type EtaCodeTypeDTO,
  type AlternateUnitDTO,
  type ItemDTO,
  type CreateItemDTO,
  type UpdateItemDTO,
} from "./items.js";

export {
  scopeSelectionSchema,
  roleSchema,
  createRoleSchema,
  updateRoleSchema,
  type ScopeSelectionDTO,
  type RoleDTO,
  type CreateRoleDTO,
  type UpdateRoleDTO,
} from "./roles.js";

export {
  userSchema,
  userStatusSchema,
  createUserSchema,
  updateUserSchema,
  type UserDTO,
  type UserStatusDTO,
  type CreateUserDTO,
  type UpdateUserDTO,
} from "./users.js";

/** Placeholder marker type until the full contract surface is filled in. */
export type ContractsPackage = "@mezan/contracts";
