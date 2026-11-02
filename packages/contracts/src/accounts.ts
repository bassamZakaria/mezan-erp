import { z } from "zod";
import { clientSuppliedId } from "./client-supplied-id.js";

/** Wire contract for the Chart of Accounts (docs/archive/catalog/04 "دليل الحسابات"). */
export const accountTypeSchema = z.enum(["asset", "liability", "equity", "revenue", "expense", "memorandum"]);
export const naturalBalanceSchema = z.enum(["debit", "credit"]);
export const accountStatusSchema = z.enum(["active", "inactive"]);

export enum AccountTypeCode {
  Asset = "asset",
  Liability = "liability",
  Equity = "equity",
  Revenue = "revenue",
  Expense = "expense",
  Memorandum = "memorandum",
}

export enum AccountStatusCode {
  Active = "active",
  Inactive = "inactive",
}

export const accountSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  type: accountTypeSchema,
  naturalBalance: naturalBalanceSchema,
  parentId: z.string().nullable(),
  isHeader: z.boolean(),
  status: accountStatusSchema,
});

export const createAccountSchema = z.object({
  id: clientSuppliedId,
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  type: accountTypeSchema,
  naturalBalance: naturalBalanceSchema,
  parentId: z.string().nullable().optional(),
  isHeader: z.boolean(),
});

/** All fields optional — a PATCH applies only what's supplied. */
export const updateAccountSchema = z.object({
  nameAr: z.string().min(1).optional(),
  nameEn: z.string().nullable().optional(),
  type: accountTypeSchema.optional(),
  naturalBalance: naturalBalanceSchema.optional(),
  parentId: z.string().nullable().optional(),
  isHeader: z.boolean().optional(),
  status: accountStatusSchema.optional(),
});

export type AccountTypeDTO = z.infer<typeof accountTypeSchema>;
export type NaturalBalanceDTO = z.infer<typeof naturalBalanceSchema>;
export type AccountStatusDTO = z.infer<typeof accountStatusSchema>;
export type AccountDTO = z.infer<typeof accountSchema>;
export type CreateAccountDTO = z.infer<typeof createAccountSchema>;
export type UpdateAccountDTO = z.infer<typeof updateAccountSchema>;

// --- توجيه الحسابات (R6.1) ---------------------------------------------

export const latePenaltyTreatmentSchema = z.enum(["revenue_deduction", "expense"]);

export const accountRoutingOptionsSchema = z.object({
  latePenaltyTreatment: latePenaltyTreatmentSchema,
  useSeparateDiscountAccount: z.boolean(),
  applyDiscountAccountToLines: z.boolean(),
});

export const accountRoutingSlotSchema = z.object({
  key: z.string(),
  section: z.enum(["tax", "leave", "contracting", "sales_discount", "inventory_adjustment", "payroll", "item_type", "control", "fx"]),
  labelAr: z.string(),
  labelEn: z.string(),
  defaultAccountId: z.string(),
  /** What this slot resolves to right now — the override if set, else the default. */
  accountId: z.string(),
  /** Whether a tenant has overridden it, so the screen can show what it changed. */
  overridden: z.boolean(),
});

export const accountRoutingSchema = z.object({
  slots: z.array(accountRoutingSlotSchema),
  options: accountRoutingOptionsSchema,
});

export const updateAccountRoutingSchema = z.object({
  /** Slot key → account id. A key mapped to null clears the override. */
  overrides: z.record(z.string(), z.string().nullable()).optional(),
  options: accountRoutingOptionsSchema.partial().optional(),
});

export type LatePenaltyTreatmentDTO = z.infer<typeof latePenaltyTreatmentSchema>;
export type AccountRoutingOptionsDTO = z.infer<typeof accountRoutingOptionsSchema>;
export type AccountRoutingSlotDTO = z.infer<typeof accountRoutingSlotSchema>;
export type AccountRoutingDTO = z.infer<typeof accountRoutingSchema>;
export type UpdateAccountRoutingDTO = z.infer<typeof updateAccountRoutingSchema>;
