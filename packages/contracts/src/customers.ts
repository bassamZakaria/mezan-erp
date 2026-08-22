import { z } from "zod";

/**
 * Wire contract for a Customer (docs/catalog/01-sales.md "العملاء"). Money
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
  openingBalance: z.string(),
  active: z.boolean(),
  priceListId: z.string().nullable(),
  creditLimit: z.string(),
  taxExempt: z.boolean(),
  etaBuyerType: etaBuyerTypeSchema,
  nationalId: z.string().nullable(),
});

/** POST /customers body — matches the catalog's "Add customer" dialog defaults. */
export const createCustomerSchema = z.object({
  id: z.string().min(1),
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
  currency: z.string().min(1).optional(),
  openingBalance: z.string().optional(),
  active: z.boolean().optional(),
  priceListId: z.string().nullable().optional(),
  creditLimit: z.string().optional(),
  taxExempt: z.boolean().optional(),
  etaBuyerType: etaBuyerTypeSchema.optional(),
  nationalId: z.string().nullable().optional(),
});

/** PATCH /customers/:id body — every field but id optional. */
export const updateCustomerSchema = customerSchema.omit({ id: true }).partial();

export type EtaBuyerTypeDTO = z.infer<typeof etaBuyerTypeSchema>;
export type CustomerDTO = z.infer<typeof customerSchema>;
export type CreateCustomerDTO = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerDTO = z.infer<typeof updateCustomerSchema>;
