import { z } from "zod";
import { moneyString } from "./money-string.js";

/**
 * Wire contract for a Customer (docs/archive/catalog/01-sales.md "العملاء"). Money
 * crosses the wire as an exact decimal string, never a float (same boundary
 * rule as journal.ts) — the domain re-parses these strings into `Money`.
 */
export const etaBuyerTypeSchema = z.enum(["auto", "business", "individual"]);

export const customerSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  contactPerson: z.string().nullable(),
  taxNumber: z.string().nullable(),
  category: z.string().nullable(),
  notes: z.string().nullable(),
  paymentTermsDays: z.number().int().nonnegative(),
  currency: z.string().min(1),
  openingBalance: moneyString,
  active: z.boolean(),
  priceListId: z.string().nullable(),
  creditLimit: z.string(),
  taxExempt: z.boolean(),
  etaBuyerType: etaBuyerTypeSchema,
  commercialRegistrationNumber: z.string().nullable(),
  address: z.string().nullable(),
  logoAttachmentId: z.string().nullable(),
  nationalId: z.string().nullable(),
  /**
   * What the customer owes today: the opening balance plus their row on the
   * customer aging ladder (D195). Read-only, sent on the list and on GET
   * /customers/:id; null when the server has no receivables source.
   */
  owed: moneyString.nullish(),
});

/** POST /customers body — matches the catalog's "Add customer" dialog defaults. */
export const createCustomerSchema = z.object({
  id: z.string().min(1),
  /** Omitted, the server allocates the next free code. */
  code: z.string().trim().min(1).optional(),
  /** The branch that owns this record; omitted, it is stamped from the creator's own scope (D71). */
  branchId: z.string().min(1).nullish(),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  taxNumber: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  paymentTermsDays: z.number().int().nonnegative().optional(),
  currency: z.string().min(1).optional(),
  openingBalance: moneyString.optional(),
  /**
   * The date the opening balance is posted at — it lands in the GL as a debit
   * to the AR control account against opening-balance equity (D142), so it
   * decides which fiscal period the migration's debtors fall in. Not stored on
   * the customer; the posted entry is the record of it. Defaults to today.
   */
  openingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  active: z.boolean().optional(),
  priceListId: z.string().nullable().optional(),
  creditLimit: z.string().optional(),
  taxExempt: z.boolean().optional(),
  etaBuyerType: etaBuyerTypeSchema.optional(),
  commercialRegistrationNumber: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  logoAttachmentId: z.string().nullable().optional(),
  nationalId: z.string().nullable().optional(),
});

/** PATCH /customers/:id body — every field but id optional. */
export const updateCustomerSchema = customerSchema
  .omit({ id: true, owed: true })
  .partial()
  .extend({ openingBalanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export type EtaBuyerTypeDTO = z.infer<typeof etaBuyerTypeSchema>;
export type CustomerDTO = z.infer<typeof customerSchema>;
export type CreateCustomerDTO = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerDTO = z.infer<typeof updateCustomerSchema>;
