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

export {
  taxCalculationTypeSchema,
  taxRateStatusSchema,
  etaVatSubTypeSchema,
  taxRateSchema,
  createTaxRateSchema,
  updateTaxRateSchema,
  type TaxCalculationTypeDTO,
  type TaxRateStatusDTO,
  type EtaVatSubTypeDTO,
  type TaxRateDTO,
  type CreateTaxRateDTO,
  type UpdateTaxRateDTO,
} from "./tax-rate.js";

export {
  costCenterTypeSchema,
  costCenterStatusSchema,
  costCenterSchema,
  createCostCenterSchema,
  updateCostCenterSchema,
  type CostCenterTypeDTO,
  type CostCenterStatusDTO,
  type CostCenterDTO,
  type CreateCostCenterDTO,
  type UpdateCostCenterDTO,
} from "./cost-center.js";

export {
  treasuryAccountTypeSchema,
  treasuryAccountStatusSchema,
  treasuryAccountSchema,
  createTreasuryAccountSchema,
  updateTreasuryAccountSchema,
  type TreasuryAccountTypeDTO,
  type TreasuryAccountStatusDTO,
  type TreasuryAccountDTO,
  type CreateTreasuryAccountDTO,
  type UpdateTreasuryAccountDTO,
} from "./treasury-account.js";

export {
  fiscalPeriodStatusSchema,
  fiscalPeriodSchema,
  generateFiscalYearSchema,
  type FiscalPeriodStatusDTO,
  type FiscalPeriodDTO,
  type GenerateFiscalYearDTO,
} from "./fiscal-period.js";

export {
  stockMovementDirectionSchema,
  adjustmentReasonSchema,
  stockSourceDocTypeSchema,
  stockMovementSchema,
  stockBalanceSchema,
  valuationRowSchema,
  valuationReportSchema,
  driftReportSchema,
  adjustmentLineSchema,
  postAdjustmentSchema,
  transferLineSchema,
  postTransferSchema,
  type StockMovementDirectionDTO,
  type AdjustmentReasonDTO,
  type StockSourceDocTypeDTO,
  type StockMovementDTO,
  type StockBalanceDTO,
  type ValuationRowDTO,
  type ValuationReportDTO,
  type DriftReportDTO,
  type AdjustmentLineDTO,
  type PostAdjustmentDTO,
  type TransferLineDTO,
  type PostTransferDTO,
} from "./inventory.js";

export {
  journalEntrySourceSchema,
  journalEntryStatusSchema,
  glJournalLineSchema,
  createGlJournalEntrySchema,
  reverseGlJournalEntrySchema,
  glJournalListQuerySchema,
  type JournalEntrySourceDTO,
  type JournalEntryStatusDTO,
  type GlJournalLineDTO,
  type CreateGlJournalEntryDTO,
  type ReverseGlJournalEntryDTO,
  type GlJournalListQueryDTO,
} from "./gl.js";

export {
  documentStatusSchema,
  documentEffectKindSchema,
  documentEffectSchema,
  documentEffectsSchema,
  journalDocumentLineSchema,
  createJournalDocumentSchema,
  journalDocumentEffectsRequestSchema,
  type DocumentStatusDTO,
  type DocumentEffectKindDTO,
  type DocumentEffectDTO,
  type DocumentEffectsDTO,
  type JournalDocumentLineDTO,
  type CreateJournalDocumentDTO,
  type JournalDocumentEffectsRequestDTO,
} from "./documents.js";

export {
  voucherTypeSchema,
  voucherDirectionSchema,
  voucherPaymentMethodSchema,
  voucherStatusSchema,
  allocationInvoiceKindSchema,
  allocationStatusSchema,
  voucherSchema,
  createVoucherSchema,
  confirmVoucherSchema,
  reverseVoucherSchema,
  openInvoiceSchema,
  voucherAllocationSchema,
  createAllocationSchema,
  allocationSummarySchema,
  voucherListQuerySchema,
  type VoucherTypeDTO,
  type VoucherDirectionDTO,
  type VoucherPaymentMethodDTO,
  type VoucherStatusDTO,
  type AllocationInvoiceKindDTO,
  type AllocationStatusDTO,
  type VoucherDTO,
  type CreateVoucherDTO,
  type ConfirmVoucherDTO,
  type ReverseVoucherDTO,
  type OpenInvoiceDTO,
  type VoucherAllocationDTO,
  type CreateAllocationDTO,
  type AllocationSummaryDTO,
  type VoucherListQueryDTO,
} from "./voucher.js";

export {
  purchaseOrderStatusSchema,
  goodsReceiptStatusSchema,
  purchaseInvoiceStatusSchema,
  purchaseInvoiceLineKindSchema,
  purchaseOrderLineSchema,
  purchaseOrderSchema,
  createPurchaseOrderLineSchema,
  createPurchaseOrderSchema,
  goodsReceiptLineSchema,
  goodsReceiptSchema,
  createGoodsReceiptLineSchema,
  createGoodsReceiptSchema,
  purchaseInvoiceLineSchema,
  purchaseInvoiceSchema,
  createPurchaseInvoiceLineSchema,
  createPurchaseInvoiceSchema,
  type PurchaseOrderStatusDTO,
  type GoodsReceiptStatusDTO,
  type PurchaseInvoiceStatusDTO,
  type PurchaseInvoiceLineKindDTO,
  type PurchaseOrderLineDTO,
  type PurchaseOrderDTO,
  type CreatePurchaseOrderDTO,
  type GoodsReceiptLineDTO,
  type GoodsReceiptDTO,
  type CreateGoodsReceiptDTO,
  type PurchaseInvoiceLineDTO,
  type PurchaseInvoiceDTO,
  type CreatePurchaseInvoiceDTO,
} from "./purchasing.js";

export {
  salesInvoiceStatusSchema,
  salesInvoiceDiscountSchema,
  createSalesInvoiceLineSchema,
  createSalesInvoiceSchema,
  confirmSalesInvoiceSchema,
  salesInvoicePaymentSchema,
  salesInvoiceListQuerySchema,
  type SalesInvoiceStatusDTO,
  type SalesInvoiceDiscountDTO,
  type CreateSalesInvoiceLineDTO,
  type CreateSalesInvoiceDTO,
  type ConfirmSalesInvoiceDTO,
  type SalesInvoicePaymentDTO,
  type SalesInvoiceListQueryDTO,
} from "./sales-invoice.js";

export {
  salesReturnReasonSchema,
  salesReturnLineSchema,
  createSalesReturnSchema,
  salesReturnRequestedQtySchema,
  buildSalesReturnFromInvoiceSchema,
  salesReturnDocumentSchema,
  type SalesReturnReasonDTO,
  type SalesReturnLineDTO,
  type CreateSalesReturnDTO,
  type BuildSalesReturnFromInvoiceDTO,
  type SalesReturnDocumentDTO,
} from "./sales-returns.js";

export {
  purchaseReturnReasonSchema,
  purchaseReturnLineSchema,
  createPurchaseReturnSchema,
  purchaseReturnRequestedQtySchema,
  buildPurchaseReturnFromInvoiceSchema,
  purchaseReturnDocumentSchema,
  type PurchaseReturnReasonDTO,
  type PurchaseReturnLineDTO,
  type CreatePurchaseReturnDTO,
  type BuildPurchaseReturnFromInvoiceDTO,
  type PurchaseReturnDocumentDTO,
} from "./purchase-returns.js";

export {
  landedCostTypeSchema,
  landedCostDistributionMethodSchema,
  landedCostItemEntrySchema,
  landedCostTargetSchema,
  createLandedCostSchema,
  landedCostLineSchema,
  landedCostDocumentSchema,
  type LandedCostTypeDTO,
  type LandedCostDistributionMethodDTO,
  type LandedCostItemEntryDTO,
  type LandedCostTargetDTO,
  type CreateLandedCostDTO,
  type LandedCostLineDTO,
  type LandedCostDocumentDTO,
} from "./landed-costs.js";

export {
  installmentFrequencySchema,
  installmentLineStatusSchema,
  createInstallmentPlanSchema,
  installmentLineSchema,
  installmentPlanDocumentSchema,
  processOverdueInstallmentsSchema,
  processOverdueInstallmentsResultSchema,
  followUpTypeSchema,
  followUpStatusSchema,
  createFollowUpSchema,
  completeFollowUpSchema,
  collectionFollowUpSchema,
  type InstallmentFrequencyDTO,
  type InstallmentLineStatusDTO,
  type CreateInstallmentPlanDTO,
  type InstallmentLineDTO,
  type InstallmentPlanDocumentDTO,
  type ProcessOverdueInstallmentsDTO,
  type ProcessOverdueInstallmentsResultDTO,
  type FollowUpTypeDTO,
  type FollowUpStatusDTO,
  type CreateFollowUpDTO,
  type CompleteFollowUpDTO,
  type CollectionFollowUpDTO,
} from "./installments.js";

export {
  dashboardCountsSchema,
  dashboardGlSchema,
  dashboardActivitySchema,
  dashboardSummarySchema,
  type DashboardCountsDTO,
  type DashboardGlDTO,
  type DashboardActivityDTO,
  type DashboardSummaryDTO,
} from "./dashboard.js";

export {
  loginRequestSchema,
  sessionSchema,
  loginResponseSchema,
  bootstrapAdminRequestSchema,
  bootstrapSeedResultSchema,
  type LoginRequestDTO,
  type SessionDTO,
  type LoginResponseDTO,
  type BootstrapAdminRequestDTO,
  type BootstrapSeedResultDTO,
} from "./auth.js";

/** Placeholder marker type until the full contract surface is filled in. */
export type ContractsPackage = "@mezan/contracts";
