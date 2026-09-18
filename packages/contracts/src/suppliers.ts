import { z } from "zod";
import { moneyString } from "./money-string.js";

/**
 * Wire contract for a Supplier (docs/archive/catalog/02-purchases.md "الموردون") —
 * the mirror of customers.ts minus the customer-only credit-limit/ETA fields,
 * plus a street address. Money crosses the wire as an exact decimal string.
 */
export const supplierSchema = z.object({
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
  addressCity: z.string().nullable(),
  addressDistrict: z.string().nullable(),
  addressStreet: z.string().nullable(),
  bankAccount: z.string().nullable(),
  /**
   * What the supplier is owed today: their row on the supplier aging ladder,
   * opening balance included (D201, D204). Read-only; null when the server has
   * no payables source.
   */
  owed: moneyString.nullish(),
});

/** POST /suppliers body — matches the catalog's "Add/Edit Supplier" modal defaults. */
export const createSupplierSchema = z.object({
  id: z.string().min(1),
  /** Omitted, the server allocates the next free code. */
  code: z.string().trim().min(1).optional(),
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
  active: z.boolean().optional(),
  addressCity: z.string().nullable().optional(),
  addressDistrict: z.string().nullable().optional(),
  addressStreet: z.string().nullable().optional(),
  bankAccount: z.string().nullable().optional(),
});

/** PATCH /suppliers/:id body — every field but id optional. */
export const updateSupplierSchema = supplierSchema.omit({ id: true, owed: true }).partial();

export type SupplierDTO = z.infer<typeof supplierSchema>;
export type CreateSupplierDTO = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierDTO = z.infer<typeof updateSupplierSchema>;
