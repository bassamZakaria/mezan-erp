import { z } from "zod";

/** Wire contract for fiscal periods (docs/catalog/04 "الفترات المالية"). */
export const fiscalPeriodStatusSchema = z.enum(["open", "closed", "locked"]);

export const fiscalPeriodSchema = z.object({
  id: z.string().min(1),
  year: z.number().int(),
  periodNumber: z.number().int().min(1).max(12),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  status: fiscalPeriodStatusSchema,
});

/** إنشاء السنة التالية — generates the 12 monthly periods for a fiscal year. */
export const generateFiscalYearSchema = z.object({
  year: z.number().int(),
});

export type FiscalPeriodStatusDTO = z.infer<typeof fiscalPeriodStatusSchema>;
export type FiscalPeriodDTO = z.infer<typeof fiscalPeriodSchema>;
export type GenerateFiscalYearDTO = z.infer<typeof generateFiscalYearSchema>;
