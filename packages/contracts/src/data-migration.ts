import { z } from "zod";

/**
 * Wire contracts for the data-migration import wizard (docs/catalog/09 "نقل
 * البيانات"): customers, suppliers, items, and item opening balances. Money/
 * Qty cross the wire as exact decimal strings (mirrors historical-import.ts).
 * The historical purchase-document import kind reuses the EXISTING
 * `historicalImportBatchSchema` (historical-import.ts) — nothing new here.
 */

const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "must be an exact decimal string");
const positiveDecimalString = z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");

export const dataMigrationRowErrorSchema = z.object({
  rowNumber: z.number().int().positive(),
  reasons: z.array(z.string()),
});

/** Response for every `/data-migration/*​/preview` and `/data-migration/*​/commit` route. */
export const dataMigrationResultSchema = z.object({
  validCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  errors: z.array(dataMigrationRowErrorSchema),
  createdIds: z.array(z.string()).optional(),
});

// --- customers ---

export const customerImportRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  taxNumber: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  paymentTermsDays: z.number().int().nonnegative().optional(),
  currency: z.string().optional(),
  openingBalance: decimalString.optional(),
  creditLimit: decimalString.optional(),
  taxExempt: z.boolean().optional(),
  etaBuyerType: z.enum(["auto", "business", "individual"]).optional(),
  nationalId: z.string().nullable().optional(),
});
export const customerImportBatchSchema = z.object({ rows: z.array(customerImportRowSchema).min(1) });

// --- suppliers ---

export const supplierImportRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  taxNumber: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  paymentTermsDays: z.number().int().nonnegative().optional(),
  currency: z.string().optional(),
  openingBalance: decimalString.optional(),
  addressCity: z.string().nullable().optional(),
  addressDistrict: z.string().nullable().optional(),
  addressStreet: z.string().nullable().optional(),
});
export const supplierImportBatchSchema = z.object({ rows: z.array(supplierImportRowSchema).min(1) });

// --- items ---

export const itemImportRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  type: z.enum(["stock", "service"]).optional(),
  baseUnitCode: z.string().min(1),
  barcodes: z.array(z.string()).optional(),
  categoryId: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  costingMethod: z.enum(["WAC", "FIFO"]).optional(),
  salePrice: decimalString.nullable().optional(),
  costPrice: decimalString.nullable().optional(),
  taxRatePercent: z.number().optional(),
  trackInventory: z.boolean().optional(),
  reorderPoint: z.number().nullable().optional(),
  reorderQty: z.number().nullable().optional(),
});
export const itemImportBatchSchema = z.object({ rows: z.array(itemImportRowSchema).min(1) });

// --- opening balances (one warehouse per batch, chosen once in the wizard) ---

export const openingBalanceImportRowSchema = z.object({
  rowNumber: z.number().int().positive(),
  itemCode: z.string().min(1),
  qty: positiveDecimalString,
  unitCost: positiveDecimalString,
});
export const openingBalanceImportBatchSchema = z.object({
  warehouseId: z.string().min(1),
  date: z.string().min(1),
  rows: z.array(openingBalanceImportRowSchema).min(1),
});

export type DataMigrationRowErrorDTO = z.infer<typeof dataMigrationRowErrorSchema>;
export type DataMigrationResultDTO = z.infer<typeof dataMigrationResultSchema>;
export type CustomerImportRowDTO = z.infer<typeof customerImportRowSchema>;
export type CustomerImportBatchDTO = z.infer<typeof customerImportBatchSchema>;
export type SupplierImportRowDTO = z.infer<typeof supplierImportRowSchema>;
export type SupplierImportBatchDTO = z.infer<typeof supplierImportBatchSchema>;
export type ItemImportRowDTO = z.infer<typeof itemImportRowSchema>;
export type ItemImportBatchDTO = z.infer<typeof itemImportBatchSchema>;
export type OpeningBalanceImportRowDTO = z.infer<typeof openingBalanceImportRowSchema>;
export type OpeningBalanceImportBatchDTO = z.infer<typeof openingBalanceImportBatchSchema>;
