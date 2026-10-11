import { z } from "zod";
import { moneyString } from "./money-string.js";

/**
 * Wire contract for treasury accounts (docs/archive/catalog/04 "حسابات الخزينة").
 * Money (opening balance) crosses the wire as an exact decimal string, never
 * a float — the domain re-parses it via `Money.fromMajor`.
 */
export const treasuryAccountTypeSchema = z.enum(["cash", "bank"]);
export const treasuryAccountStatusSchema = z.enum(["active", "inactive"]);

export const treasuryAccountSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().nullable(),
  type: treasuryAccountTypeSchema,
  currency: z.string().min(1),
  /** رقم الحساب البنكي / IBAN — what an imported statement file's account id is checked against. */
  bankAccountNumber: z.string().nullable(),
  /** Null for an account the company holds and no branch owns. */
  branchId: z.string().min(1).nullable(),
  glAccountId: z.string().nullable(),
  openingBalance: moneyString,
  openingBalanceDate: z.string().nullable(),
  /** حد تسهيلات خطابات الضمان — null when the bank has no facility configured. */
  guaranteeFacilityLimit: moneyString.nullable(),
  status: treasuryAccountStatusSchema,
});

export const createTreasuryAccountSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  type: treasuryAccountTypeSchema.optional(),
  currency: z.string().min(1).optional(),
  bankAccountNumber: z.string().trim().max(64).nullable().optional(),
  branchId: z.string().min(1).nullable(),
  glAccountId: z.string().nullable().optional(),
  openingBalance: moneyString.optional(),
  openingBalanceDate: z.string().nullable().optional(),
  guaranteeFacilityLimit: moneyString.nullable().optional(),
});

/** All fields optional — a PATCH applies only what's supplied. Also used for "إضافة رصيد افتتاحي". */
export const updateTreasuryAccountSchema = z.object({
  name: z.string().min(1).optional(),
  nameEn: z.string().nullable().optional(),
  type: treasuryAccountTypeSchema.optional(),
  currency: z.string().min(1).optional(),
  bankAccountNumber: z.string().trim().max(64).nullable().optional(),
  branchId: z.string().min(1).nullable().optional(),
  glAccountId: z.string().nullable().optional(),
  openingBalance: moneyString.optional(),
  openingBalanceDate: z.string().nullable().optional(),
  guaranteeFacilityLimit: moneyString.nullable().optional(),
  status: treasuryAccountStatusSchema.optional(),
});

export type TreasuryAccountTypeDTO = z.infer<typeof treasuryAccountTypeSchema>;
export type TreasuryAccountStatusDTO = z.infer<typeof treasuryAccountStatusSchema>;
export type TreasuryAccountDTO = z.infer<typeof treasuryAccountSchema>;
export type CreateTreasuryAccountDTO = z.infer<typeof createTreasuryAccountSchema>;
export type UpdateTreasuryAccountDTO = z.infer<typeof updateTreasuryAccountSchema>;
