import { z } from "zod";

/** Wire contract for the tenant settings config bag (docs/catalog/09 §"عام"). */
export const tenantSettingsSchema = z.object({
  currency: z.string().length(3),
  secondaryCurrencies: z.array(z.string().length(3)),
  language: z.enum(["ar", "en", "de"]),
  timezone: z.string().min(1),
  direction: z.enum(["LTR", "RTL"]),
  dateFormat: z.string().min(1),
  dateNumerals: z.enum(["western", "arabic"]),
  weekendDays: z.array(z.number().int().min(0).max(6)),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  fxRateMissingPolicy: z.enum(["STRICT", "ALLOW_MISSING"]),

  companyName: z.string(),
  taxRegistrationNumber: z.string(),
  commercialRegistrationNumber: z.string(),
  phone: z.string(),
  email: z.string(),
  address: z.string(),
  hrContractExpiryWarningDays: z.number().int().min(7).max(365),
  overtimeMultiplier: z.number().positive(),
  standardDailyWorkHours: z.number().positive().max(24),

  taxEnabled: z.boolean(),
  defaultTaxRate: z.number().min(0).max(100),
  taxCalculation: z.enum(["EXCLUSIVE", "INCLUSIVE"]),
  depreciationProrate: z.enum(["DAILY", "FULL_MONTH"]),

  priceListsEnabled: z.boolean(),
  creditControlEnabled: z.boolean(),
  creditControlMode: z.enum(["WARNING", "BLOCK"]),

  allowCrossWarehouseSales: z.boolean(),
  showOtherWarehouseStock: z.boolean(),
  allowBackorder: z.boolean(),
  allowNegativeStock: z.boolean(),

  requirePoForGrn: z.boolean(),
  requireGrnForInvoice: z.boolean(),
  trackSoldPurchaseItems: z.boolean(),

  preventNegativeCashBalance: z.boolean(),
  allowNegativeTreasury: z.boolean(),
});

/** PATCH /settings body — every field optional. */
export const updateTenantSettingsSchema = tenantSettingsSchema.partial();

export type TenantSettingsDTO = z.infer<typeof tenantSettingsSchema>;
export type UpdateTenantSettingsDTO = z.infer<typeof updateTenantSettingsSchema>;
