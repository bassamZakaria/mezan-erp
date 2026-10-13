import { z } from "zod";
import { clientSuppliedId } from "./client-supplied-id.js";

/** Wire contract for exchange rates (docs/archive/catalog/04 "أسعار الصرف"). */
export const exchangeRateTypeSchema = z.enum(["standard", "buy", "sell"]);
export const exchangeRateSourceSchema = z.enum(["manual", "api"]);
export const exchangeRateStatusSchema = z.enum(["pending", "approved", "locked"]);

/** Rate is an exact decimal string (base units per one foreign unit). */
export const exchangeRateSchema = z.object({
  id: z.string().min(1),
  currency: z.string().min(1),
  rate: z.string().min(1),
  effectiveDate: z.string().min(1),
  rateType: exchangeRateTypeSchema,
  source: exchangeRateSourceSchema,
  status: exchangeRateStatusSchema,
});

export const createExchangeRateSchema = z.object({
  id: clientSuppliedId,
  currency: z.string().min(1),
  rate: z.string().min(1),
  effectiveDate: z.string().min(1),
  rateType: exchangeRateTypeSchema.optional(),
  source: exchangeRateSourceSchema.optional(),
  status: exchangeRateStatusSchema.optional(),
});

export type ExchangeRateTypeDTO = z.infer<typeof exchangeRateTypeSchema>;
export type ExchangeRateSourceDTO = z.infer<typeof exchangeRateSourceSchema>;
export type ExchangeRateStatusDTO = z.infer<typeof exchangeRateStatusSchema>;
export type ExchangeRateDTO = z.infer<typeof exchangeRateSchema>;
export type CreateExchangeRateDTO = z.infer<typeof createExchangeRateSchema>;
