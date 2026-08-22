import { z } from "zod";

/** Wire contract for the Chart of Accounts (docs/catalog/04 "دليل الحسابات"). */
export const accountTypeSchema = z.enum(["asset", "liability", "equity", "revenue", "expense"]);
export const naturalBalanceSchema = z.enum(["debit", "credit"]);
export const accountStatusSchema = z.enum(["active", "inactive"]);

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
  id: z.string().min(1),
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
