import { z } from "zod";
import { nonNegativeMoneyString } from "../money-string.js";

export const posPaymentMethodKindSchema = z.enum(["cash", "card", "wallet", "transfer", "on_account"]);
export const posPaymentAccountTypeSchema = z.enum(["cash", "bank"]);
export const posTerminalKindSchema = z.enum(["retail", "restaurant"]);
export const posPrinterKindSchema = z.enum(["system", "escpos-tcp"]);
export const posTerminalIssueSchema = z.enum(["inactive", "setup_broken", "eta_device_missing", "eta_credentials_missing"]);

const codeSchema = z.string().trim().min(1).max(20);
const optionalText = z.string().nullable().optional();

export const posPaymentMethodSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  kind: posPaymentMethodKindSchema,
  accountType: posPaymentAccountTypeSchema.nullable(),
  defaultTreasuryAccountId: z.string().nullable(),
  builtIn: z.boolean(),
  active: z.boolean(),
  /** Codes of the terminals this method is enabled on. */
  usedBy: z.array(z.string()),
});

export const createPosPaymentMethodSchema = z.object({
  code: codeSchema,
  nameAr: z.string().trim().min(1),
  nameEn: optionalText,
  kind: posPaymentMethodKindSchema.exclude(["cash"]),
  accountType: posPaymentAccountTypeSchema.nullable().optional(),
  defaultTreasuryAccountId: optionalText,
  active: z.boolean().optional(),
});

/** No `code` and no `kind`: both are fixed once a sale can carry them. */
export const updatePosPaymentMethodSchema = z.object({
  nameAr: z.string().trim().min(1).optional(),
  nameEn: optionalText,
  accountType: posPaymentAccountTypeSchema.nullable().optional(),
  defaultTreasuryAccountId: optionalText,
  active: z.boolean().optional(),
});

export const posPrinterConfigSchema = z.object({
  kind: posPrinterKindSchema,
  address: z.string().max(260).nullable(),
  paperWidthMm: z.union([z.literal(58), z.literal(80)]),
});

export const posTerminalMethodSchema = z.object({
  methodId: z.string().min(1),
  treasuryAccountId: z.string().nullable(),
});

export const posTerminalSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  kind: posTerminalKindSchema,
  branchId: z.string(),
  warehouseId: z.string(),
  drawerTreasuryAccountId: z.string(),
  methods: z.array(posTerminalMethodSchema),
  defaultMethodId: z.string(),
  printer: posPrinterConfigSchema,
  etaDeviceSerial: z.string().nullable(),
  etaPosClientId: z.string().nullable(),
  etaPosOsVersion: z.string().nullable(),
  etaPosModelFramework: z.string().nullable(),
  hasEtaPosClientSecret: z.boolean(),
  hasEtaPosPresharedKey: z.boolean(),
  active: z.boolean(),
  lastReceiptSeq: z.number().int(),
  /** The device the authority will see on this till's receipts — its own, or the branch's (DEC-25). */
  etaDevice: z
    .object({
      source: z.enum(["terminal", "branch"]),
      serial: z.string(),
      posClientId: z.string().nullable(),
      hasSecret: z.boolean(),
      complete: z.boolean(),
    })
    .nullable(),
  issues: z.array(posTerminalIssueSchema),
});

const terminalBody = {
  code: codeSchema,
  name: z.string().trim().min(1),
  nameEn: optionalText,
  kind: posTerminalKindSchema.optional(),
  branchId: z.string().min(1),
  warehouseId: z.string().min(1),
  drawerTreasuryAccountId: z.string().min(1),
  methods: z.array(posTerminalMethodSchema).min(1),
  defaultMethodId: z.string().min(1),
  printer: posPrinterConfigSchema.optional(),
  etaDeviceSerial: optionalText,
  etaPosClientId: optionalText,
  etaPosOsVersion: optionalText,
  etaPosModelFramework: optionalText,
  /** Write-only. Omitted or empty keeps the stored value. */
  etaPosClientSecret: z.string().max(500).optional(),
  etaPosPresharedKey: z.string().max(500).optional(),
  active: z.boolean().optional(),
};

export const createPosTerminalSchema = z.object(terminalBody);
export const updatePosTerminalSchema = z.object(terminalBody);

const percentString = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, "must be a percentage with at most two decimals");

export const posDiscountLimitSchema = z.object({
  percent: percentString,
  amount: nonNegativeMoneyString,
});

export const posMealSectionSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const posSettingsSchema = z.object({
  receiptScreenSeconds: z.number().int(),
  allowArCollection: z.boolean(),
  cashierDiscountLimit: posDiscountLimitSchema,
  managerDiscountLimit: posDiscountLimitSchema,
  approvalExpiryMinutes: z.number().int(),
  walkInCustomerId: z.string(),
  pricesIncludeTax: z.boolean(),
  mealSections: z.array(posMealSectionSchema),
});

export const updatePosSettingsSchema = z.object({
  receiptScreenSeconds: z.number().int().optional(),
  allowArCollection: z.boolean().optional(),
  cashierDiscountLimit: posDiscountLimitSchema.optional(),
  managerDiscountLimit: posDiscountLimitSchema.optional(),
  approvalExpiryMinutes: z.number().int().optional(),
  pricesIncludeTax: z.boolean().optional(),
  mealSections: z.array(z.object({ id: z.string().nullable().optional(), name: z.string().max(80) })).max(30).optional(),
});

export const posCallerDiscountLimitSchema = posDiscountLimitSchema.extend({
  tier: z.enum(["cashier", "manager"]),
});

export const shiftTemplateSchema = z.object({
  id: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  fromTime: z.string(),
  toTime: z.string(),
  branchId: z.string().nullable(),
  active: z.boolean(),
  crossesMidnight: z.boolean(),
});

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM");

export const createShiftTemplateSchema = z.object({
  nameAr: z.string().trim().min(1),
  nameEn: optionalText,
  fromTime: timeString,
  toTime: timeString,
  branchId: optionalText,
  active: z.boolean().optional(),
});

export const updateShiftTemplateSchema = createShiftTemplateSchema;

export type PosPaymentMethodKindDTO = z.infer<typeof posPaymentMethodKindSchema>;
export type PosPaymentAccountTypeDTO = z.infer<typeof posPaymentAccountTypeSchema>;
export type PosTerminalKindDTO = z.infer<typeof posTerminalKindSchema>;
export type PosPrinterKindDTO = z.infer<typeof posPrinterKindSchema>;
export type PosTerminalIssueDTO = z.infer<typeof posTerminalIssueSchema>;
export type PosPaymentMethodDTO = z.infer<typeof posPaymentMethodSchema>;
export type CreatePosPaymentMethodDTO = z.infer<typeof createPosPaymentMethodSchema>;
export type UpdatePosPaymentMethodDTO = z.infer<typeof updatePosPaymentMethodSchema>;
export type PosPrinterConfigDTO = z.infer<typeof posPrinterConfigSchema>;
export type PosTerminalMethodDTO = z.infer<typeof posTerminalMethodSchema>;
export type PosTerminalDTO = z.infer<typeof posTerminalSchema>;
export type CreatePosTerminalDTO = z.infer<typeof createPosTerminalSchema>;
export type UpdatePosTerminalDTO = z.infer<typeof updatePosTerminalSchema>;
export type PosDiscountLimitDTO = z.infer<typeof posDiscountLimitSchema>;
export type PosSettingsDTO = z.infer<typeof posSettingsSchema>;
export type UpdatePosSettingsDTO = z.infer<typeof updatePosSettingsSchema>;
export type PosCallerDiscountLimitDTO = z.infer<typeof posCallerDiscountLimitSchema>;
export type ShiftTemplateDTO = z.infer<typeof shiftTemplateSchema>;
export type CreateShiftTemplateDTO = z.infer<typeof createShiftTemplateSchema>;
export type UpdateShiftTemplateDTO = z.infer<typeof updateShiftTemplateSchema>;
